import { Fragment, useEffect, useState } from 'react';
import { findCommand } from '../commands';
import {
  distinctGpus,
  formatMb,
  reportText,
  runDiagnostic,
  type DiagnosticReport,
  type GpuInfo,
} from '../diagnostics';
import { getLang, setLang, useT } from '../i18n';
import { isDesktop, pickFile, saveBytes } from '../io';
import { resetPanels } from '../panels/panelLayout';
import {
  DEFAULT_PERF,
  PERF_LIMITS,
  exportPreferences,
  importPreferences,
  memoryBudgetMb,
  needsRestart,
  readSystemMemory,
  resetAllPreferences,
  resetPerf,
  setPerf,
  threadCount,
  usePerf,
  usedMemoryMb,
  type GpuBackend,
  type GpuPreference,
  type PerfPrefs,
  type PreviewQuality,
} from '../preferences';
import { editor, setSettings, toast, ui, useUi, type PrefsTab } from '../store';
import { Modal } from './Dialogs';
import { NumberField, Select } from './fields';
import { Icon, type IconName } from './Icon';
import { ShortcutsEditor } from './ShortcutsDialog';
import { renderStats, type RenderStats } from '../perf';
import {
  nativeEngineInfo,
  rustEngineStatus,
  startRustEngine,
  type NativeEngineInfo,
  type RustEngineStatus,
} from '../engine';

const close = () => ui.set({ dialog: null });

const TABS: { id: PrefsTab; icon: IconName }[] = [
  { id: 'general', icon: 'settings' },
  { id: 'performance', icon: 'histogram' },
  { id: 'display', icon: 'eye' },
  { id: 'layers', icon: 'arrange' },
  { id: 'shortcuts', icon: 'keyboard' },
  { id: 'advanced', icon: 'adjust' },
  { id: 'diagnostic', icon: 'search' },
];

/**
 * Édition > Préférences (Ctrl ou Cmd + virgule), comme dans Affinity et Photoshop : une catégorie à
 * gauche, ses réglages à droite. Les changements s'appliquent tout de suite et sont enregistrés.
 */
export function PreferencesDialog() {
  const t = useT();
  const tab = useUi((s) => s.prefsTab);
  return (
    <Modal title={t('prefs.title')} onClose={close} xl>
      <div className="new-layout prefs">
        <nav className="new-nav" aria-label={t('prefs.title')}>
          {TABS.map(({ id, icon }) => (
            <button
              key={id}
              aria-pressed={tab === id}
              data-testid={`prefs-tab-${id}`}
              onClick={() => ui.set({ prefsTab: id })}
            >
              <Icon name={icon} />
              {t(`prefs.tab.${id}`)}
            </button>
          ))}
        </nav>
        <div className="new-main prefs-main" data-testid={`prefs-${tab}`}>
          {tab === 'general' && <GeneralPane />}
          {tab === 'performance' && <PerformancePane />}
          {tab === 'display' && <DisplayPane />}
          {tab === 'layers' && <LayersPane />}
          {tab === 'shortcuts' && <ShortcutsEditor />}
          {tab === 'advanced' && <AdvancedPane />}
          {tab === 'diagnostic' && <DiagnosticPane />}
        </div>
      </div>
    </Modal>
  );
}

function Check({
  label,
  checked,
  onChange,
  testId,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="prefs-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function GeneralPane() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  return (
    <>
      <Section title={t('prefs.language')}>
        <Select
          value={getLang()}
          width={200}
          testId="prefs-language"
          options={[
            { value: 'fr', label: 'Français' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(l) => setLang(l)}
        />
      </Section>
      <Section title={t('prefs.tab.general')}>
        <Check
          label={t('prefs.welcome')}
          checked={settings.showWelcome}
          onChange={(v) => setSettings({ showWelcome: v })}
        />
        <Check
          label={t('prefs.autoUpdate')}
          checked={settings.autoUpdate}
          disabled={!isDesktop()}
          onChange={(v) => setSettings({ autoUpdate: v })}
        />
        {!isDesktop() && <p className="note small">{t('prefs.autoUpdateWeb')}</p>}
      </Section>
    </>
  );
}

/** Mémoire utilisée, relue toutes les deux secondes tant que la fenêtre est ouverte. */
function useMemory() {
  const [state, setState] = useState<{ used: number | null; total: number | null; free: number | null }>({
    used: usedMemoryMb(),
    total: null,
    free: null,
  });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const sys = await readSystemMemory();
      if (alive) setState({ used: usedMemoryMb(), total: sys.totalMb, free: sys.availableMb });
    };
    void read();
    const id = setInterval(read, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

/** Profils : économie d'énergie, équilibré, puissance (mode performance). */
const PROFILES: Record<'saver' | 'balanced' | 'power', Partial<PerfPrefs>> = {
  saver: {
    cacheMb: 128,
    historyLimit: 50,
    previewQuality: 'fast',
    gpuPreference: 'low-power',
    vramMb: 512,
    threads: 1,
  },
  balanced: {
    cacheMb: DEFAULT_PERF.cacheMb,
    historyLimit: DEFAULT_PERF.historyLimit,
    previewQuality: DEFAULT_PERF.previewQuality,
    gpuPreference: 'default',
    vramMb: DEFAULT_PERF.vramMb,
    threads: 0,
  },
  power: {
    cacheMb: 2048,
    historyLimit: 1000,
    previewQuality: 'full',
    gpuPreference: 'high-performance',
    vramMb: 4096,
    threads: 0,
  },
};

/** Le moteur Rust (WebAssembly) est-il chargé ? */
function useEngineReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void startRustEngine().then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/** Interfaces graphiques possibles sur ce système. */
function backendsHere(): GpuBackend[] {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return ['auto', 'metal'];
  if (/Windows/.test(ua)) return ['auto', 'dx12', 'vulkan', 'gl'];
  return ['auto', 'vulkan', 'gl'];
}

/** Cartes graphiques vues par le moteur Rust (appli de bureau), relues quand les réglages changent. */
function useNativeEngine(perf: PerfPrefs): NativeEngineInfo | null {
  const [info, setInfo] = useState<NativeEngineInfo | null>(null);
  useEffect(() => {
    let alive = true;
    // Laisse le moteur prendre en compte le nouveau réglage avant de relire son état.
    const id = setTimeout(() => void nativeEngineInfo().then((i) => alive && setInfo(i)), 50);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [perf.gpuPreference, perf.gpuBackend, perf.vramMb]);
  return info;
}

function PerformancePane() {
  const t = useT();
  const perf = usePerf();
  const settings = useUi((s) => s.settings);
  const native = useNativeEngine(perf);
  const engineReady = useEngineReady();
  const mem = useMemory();
  const desktop = isDesktop();
  const cores = navigator.hardwareConcurrency || 1;
  const budget = memoryBudgetMb(perf);
  const gb = [1, 2, 4, 8, 16, 32, 64].map((g) => g * 1024).filter((m) => !mem.total || m < mem.total);
  const budgetOptions = [
    {
      value: 0,
      label: t('prefs.autoValue', { value: formatMb(memoryBudgetMb({ ...perf, memoryBudgetMb: 0 })) }),
    },
    ...gb.map((m) => ({ value: m, label: formatMb(m) })),
  ];
  if (perf.memoryBudgetMb > 0 && !gb.includes(perf.memoryBudgetMb))
    budgetOptions.push({ value: perf.memoryBudgetMb, label: formatMb(perf.memoryBudgetMb) });
  const usedRatio = mem.used !== null ? Math.min(1, mem.used / budget) : 0;
  return (
    <>
      <Section title={t('prefs.profile')}>
        <div className="row-buttons">
          {(['saver', 'balanced', 'power'] as const).map((p) => (
            <button
              key={p}
              className="btn"
              data-testid={`prefs-profile-${p}`}
              onClick={() => setPerf(PROFILES[p])}
            >
              {t(`prefs.profile.${p}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('prefs.memory')}>
        <div className="mem-meter" data-testid="prefs-memory">
          <div className="mem-bar" aria-hidden="true">
            <span
              style={{ width: `${Math.round(usedRatio * 100)}%` }}
              className={usedRatio > 0.85 ? 'high' : ''}
            />
          </div>
          <dl className="prefs-facts">
            <dt>{t('prefs.memoryUsed')}</dt>
            <dd>
              {mem.used !== null ? `${formatMb(mem.used)} / ${formatMb(budget)}` : t('prefs.memoryUnknown')}
            </dd>
            <dt>{t('prefs.memoryComputer')}</dt>
            <dd>
              {formatMb(mem.total)}
              {mem.free !== null && ` · ${t('prefs.memoryFree', { free: formatMb(mem.free) })}`}
            </dd>
          </dl>
        </div>
        <div className="prefs-grid">
          <Select
            label={t('prefs.memoryBudget')}
            value={perf.memoryBudgetMb}
            testId="prefs-memory-budget"
            options={budgetOptions}
            onChange={(v) => setPerf({ memoryBudgetMb: v })}
          />
          <Select
            label={t('prefs.cache')}
            value={perf.cacheMb}
            testId="prefs-cache"
            options={[0, 128, 256, 512, 1024, 2048, 4096].map((m) => ({
              value: m,
              label: m ? formatMb(m) : t('prefs.cacheOff'),
            }))}
            onChange={(v) => setPerf({ cacheMb: v })}
          />
          <NumberField
            label={t('prefs.history')}
            value={perf.historyLimit}
            min={PERF_LIMITS.historyLimit[0]}
            max={PERF_LIMITS.historyLimit[1]}
            testId="prefs-history"
            onChange={(v) => setPerf({ historyLimit: v })}
          />
          <Select<PreviewQuality>
            label={t('prefs.preview')}
            value={perf.previewQuality}
            testId="prefs-preview"
            options={(['fast', 'balanced', 'full'] as const).map((q) => ({
              value: q,
              label: t(`prefs.preview.${q}`),
            }))}
            onChange={(v) => setPerf({ previewQuality: v })}
          />
        </div>
        <p className="note small">{t('prefs.memoryBudgetNote')}</p>
        <p className="note small">{t('prefs.historyNote')}</p>
      </Section>

      <Section title={t('prefs.gpu')}>
        <div className="prefs-grid">
          <Select<GpuPreference>
            label={t('prefs.gpuPreference')}
            value={perf.gpuPreference}
            testId="prefs-gpu"
            options={(['default', 'high-performance', 'low-power', 'cpu'] as const).map((g) => ({
              value: g,
              label: t(`prefs.gpu.${g}`),
            }))}
            onChange={(v) => setPerf({ gpuPreference: v })}
          />
          <Select<GpuBackend>
            label={t('prefs.gpuBackend')}
            value={perf.gpuBackend}
            testId="prefs-gpu-backend"
            disabled={!desktop || perf.gpuPreference === 'cpu'}
            options={[...new Set([...backendsHere(), perf.gpuBackend])].map((b) => ({
              value: b,
              label: t(`prefs.backend.${b}`),
            }))}
            onChange={(v) => setPerf({ gpuBackend: v })}
          />
          <Select
            label={t('prefs.vram')}
            value={perf.vramMb}
            testId="prefs-vram"
            disabled={!desktop || perf.gpuPreference === 'cpu'}
            options={[...new Set([256, 512, 1024, 2048, 4096, 8192, perf.vramMb])]
              .sort((a, b) => a - b)
              .map((m) => ({ value: m, label: formatMb(m) }))}
            onChange={(v) => setPerf({ vramMb: v })}
          />
        </div>
        <Check
          label={t('prefs.perfMeter')}
          checked={settings.perfMeter}
          testId="prefs-perf-meter-perf"
          onChange={(v) => setSettings({ perfMeter: v })}
        />
        <dl className="prefs-facts" data-testid="prefs-engine">
          <dt>{t('prefs.engine')}</dt>
          <dd>{t(engineReady ? 'prefs.engineOn' : 'prefs.engineLoading')}</dd>
          {native && (
            <>
              <dt>{t('prefs.engineGpu')}</dt>
              <dd data-testid="prefs-engine-gpu">
                {native.active
                  ? `${native.active.name} (${native.active.backend})`
                  : t('prefs.engineCpu', { n: native.cores })}
              </dd>
              {native.adapters.length > 0 && (
                <>
                  <dt>{t('prefs.engineAdapters')}</dt>
                  <dd>
                    {native.adapters.map((a) => `${a.name} · ${t(`prefs.kind.${a.kind}`)}`).join(' ; ')}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        <p className="note small">{t(desktop ? 'prefs.gpuNoteDesktop' : 'prefs.gpuNoteWeb')}</p>
        {needsRestart(perf) && (
          <div className="prefs-restart" role="status">
            {t('prefs.restartNeeded')}
            <button
              className="btn primary"
              onClick={() =>
                void import('@tauri-apps/plugin-process').then(({ relaunch }) => relaunch()).catch(() => {})
              }
            >
              {t('prefs.restart')}
            </button>
          </div>
        )}
        <button className="link" onClick={() => ui.set({ prefsTab: 'diagnostic' })}>
          {t('diag.run')}
        </button>
      </Section>

      <Section title={t('prefs.cpu')}>
        <Select
          label={t('prefs.threads')}
          value={perf.threads}
          width={260}
          testId="prefs-threads"
          options={[
            { value: 0, label: t('prefs.autoValue', { value: threadCount({ ...perf, threads: 0 }) }) },
            ...Array.from({ length: cores }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
          ]}
          onChange={(v) => setPerf({ threads: v })}
        />
        <p className="note small">
          {self.crossOriginIsolated ? t('prefs.threadsNote', { cores }) : t('prefs.threadsUnavailable')}
        </p>
      </Section>

      <Section title={t('prefs.autosave')}>
        <Check
          label={t('prefs.autosave')}
          checked={perf.autosave}
          testId="prefs-autosave"
          onChange={(v) => setPerf({ autosave: v })}
        />
        <NumberField
          label={t('prefs.autosaveDelay')}
          value={perf.autosaveDelaySec}
          min={PERF_LIMITS.autosaveDelaySec[0]}
          max={PERF_LIMITS.autosaveDelaySec[1]}
          step={0.5}
          decimals={1}
          unit="s"
          width={200}
          disabled={!perf.autosave}
          onChange={(v) => setPerf({ autosaveDelaySec: v })}
        />
        <p className="note small">{t('prefs.autosaveNote')}</p>
      </Section>

      <footer>
        <button className="btn" data-testid="prefs-reset-perf" onClick={resetPerf}>
          {t('prefs.resetPerf')}
        </button>
      </footer>
    </>
  );
}

function DisplayPane() {
  const t = useT();
  const s = useUi((st) => st.settings);
  return (
    <>
      <Section title={t('prefs.interface')}>
        <div className="prefs-grid">
          <Select
            label={t('prefs.theme')}
            testId="prefs-theme"
            value={s.theme}
            options={[
              { value: 'dark', label: t('view.themeDark') },
              { value: 'light', label: t('view.themeLight') },
            ]}
            onChange={(v) => setSettings({ theme: v })}
          />
          <Select
            label={t('view.toolsSide')}
            value={s.toolsSide}
            options={[
              { value: 'left', label: t('view.left') },
              { value: 'right', label: t('view.right') },
            ]}
            onChange={(v) => setSettings({ toolsSide: v })}
          />
          <Select
            label={t('view.toolsColumns')}
            value={s.toolsColumns}
            options={[
              { value: 'auto', label: t('view.toolsColumns.auto') },
              { value: 'one', label: t('view.toolsColumns.one') },
              { value: 'two', label: t('view.toolsColumns.two') },
            ]}
            onChange={(v) => setSettings({ toolsColumns: v })}
          />
          <Select
            label={t('view.toolsLayout')}
            value={s.toolsLayout}
            options={[
              { value: 'all', label: t('view.toolsLayout.all') },
              { value: 'groups', label: t('view.toolsLayout.groups') },
            ]}
            onChange={(v) => setSettings({ toolsLayout: v })}
          />
          <Select
            label={t('view.studioSide')}
            value={s.studioSide}
            options={[
              { value: 'left', label: t('view.left') },
              { value: 'right', label: t('view.right') },
            ]}
            onChange={(v) => setSettings({ studioSide: v })}
          />
        </div>
        <Check
          label={t('view.toolsLocked')}
          checked={s.toolsLocked}
          testId="prefs-tools-locked"
          onChange={(v) => setSettings({ toolsLocked: v })}
        />
        <Check
          label={t('prefs.perfMeter')}
          checked={s.perfMeter}
          testId="prefs-perf-meter"
          onChange={(v) => setSettings({ perfMeter: v })}
        />
        <button className="btn" onClick={() => resetPanels()}>
          {t('view.resetPanels')}
        </button>
      </Section>
      <Section title={t('prefs.canvas')}>
        <Check label={t('view.rulers')} checked={s.rulers} onChange={(v) => setSettings({ rulers: v })} />
        <Check label={t('view.grid')} checked={s.grid} onChange={(v) => setSettings({ grid: v })} />
        <Check
          label={t('view.snapping')}
          checked={s.snapping}
          onChange={(v) => setSettings({ snapping: v })}
        />
      </Section>
    </>
  );
}

/** Commandes d'ordre et d'organisation des calques, dont on peut changer le raccourci ici. */
const LAYER_COMMANDS = [
  'arrange.front',
  'arrange.forward',
  'arrange.backward',
  'arrange.back',
  'layer.selectAbove',
  'layer.selectBelow',
  'layer.group',
  'layer.ungroup',
  'layer.lock',
  'layer.hide',
];

function LayersPane() {
  const t = useT();
  return (
    <Section title={t('prefs.layersOrder')}>
      <p className="note">{t('prefs.layersOrderNote')}</p>
      <ShortcutsEditor only={LAYER_COMMANDS.filter((id) => findCommand(id))} />
    </Section>
  );
}

function AdvancedPane() {
  const t = useT();
  const doExport = async () => {
    await saveBytes(new TextEncoder().encode(exportPreferences()), 'prefs', 'preferences');
  };
  const doImport = async () => {
    const file = await pickFile(['poulpeprefs', 'json'], '.poulpeprefs,application/json');
    if (!file) return;
    if (!importPreferences(new TextDecoder().decode(file.bytes))) {
      toast(t('prefs.importError'));
      return;
    }
    toast(t('prefs.imported'));
    setTimeout(() => location.reload(), 600);
  };
  const doReset = () => {
    if (!window.confirm(t('prefs.resetAllConfirm'))) return;
    resetAllPreferences();
    location.reload();
  };
  return (
    <>
      <Section title={t('prefs.backup')}>
        <p className="note">{t('prefs.backupNote')}</p>
        <div className="row-buttons">
          <button className="btn" data-testid="prefs-export" onClick={() => void doExport()}>
            {t('prefs.export')}
          </button>
          <button className="btn" data-testid="prefs-import" onClick={() => void doImport()}>
            {t('prefs.import')}
          </button>
        </div>
      </Section>
      <Section title={t('prefs.resetAll')}>
        <button className="btn danger" data-testid="prefs-reset-all" onClick={doReset}>
          {t('prefs.resetAll')}
        </button>
      </Section>
    </>
  );
}

function GpuLine({ label, gpu }: { label: string; gpu: GpuInfo | null }) {
  const t = useT();
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {gpu
          ? `${gpu.renderer}${gpu.vendor && !gpu.renderer?.includes(gpu.vendor) ? ` (${gpu.vendor})` : ''}`
          : t('diag.none')}
      </dd>
    </>
  );
}

/** Moteur Rust, en texte pour le rapport copié. */
function engineText(e: RustEngineStatus): string {
  const lines = [
    `Moteur Rust : WebAssembly ${e.wasm.active ? `${e.wasm.version}, ${e.wasm.calls} calculs, ${e.wasm.meanMs.toFixed(1)} ms en moyenne` : 'non chargé'}`,
  ];
  if (e.native) {
    lines.push(
      `Moteur natif : ${e.native.active ? `${e.native.active.name} (${e.native.active.backend}, ${e.native.active.driver})` : `processeur, ${e.native.cores} cœurs`}`,
      `Cartes : ${e.native.adapters.map((a) => `${a.name} [${a.kind}, ${a.backend}]`).join(' ; ') || 'aucune'}`,
      `Réglages : ${e.native.settings.device}, ${e.native.settings.backend}, ${e.native.settings.vramMb} Mo`,
      ...Object.entries(e.native.timings).map(
        ([k, v]) => `${k} : ${v.meanMs.toFixed(0)} ms en moyenne (${v.count})`,
      ),
    );
  }
  return lines.join('\n');
}

function DiagnosticPane() {
  const t = useT();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [bench, setBench] = useState<number | null | 'running'>(null);
  const [render, setRender] = useState<RenderStats>(() => renderStats());
  useEffect(() => {
    const id = setInterval(() => setRender(renderStats()), 1000);
    return () => clearInterval(id);
  }, []);
  const [engine, setEngine] = useState<RustEngineStatus | null>(null);
  const run = async () => {
    setRunning(true);
    try {
      setReport(await runDiagnostic());
      await startRustEngine();
      setEngine(await rustEngineStatus());
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    void run();
  }, []);
  const copy = async () => {
    if (!report) return;
    const text =
      reportText(report) +
      `\nRendu : cache ${render.usedMb} / ${render.budgetMb} Mo (${render.entries} images), image ${render.frameAvgMs} ms en moyenne, ${render.frameMaxMs} ms au pire` +
      (engine ? `\n${engineText(engine)}` : '') +
      (typeof bench === 'number' ? `\nTest de vitesse : ${bench} i/s` : '');
    try {
      await navigator.clipboard.writeText(text);
      toast(t('diag.copied'));
    } catch {
      /* presse-papiers refusé */
    }
  };
  const runBench = async () => {
    setBench('running');
    const snap = editor.snapshot();
    const view = ui.get().view;
    try {
      const { runBenchmark } = await import('../bench');
      const r = await runBenchmark();
      setBench(Math.round(r.results.reduce((s, x) => s + x.fps, 0) / r.results.length));
    } catch {
      setBench(null);
    } finally {
      editor.restore(snap);
      ui.set({ view });
    }
  };
  const gpus = report ? distinctGpus(report) : 0;
  return (
    <>
      <p className="note">{t('diag.intro')}</p>
      <div className="row-buttons">
        <button className="btn primary" data-testid="diag-run" disabled={running} onClick={() => void run()}>
          {running ? t('diag.running') : t('diag.run')}
        </button>
        <button className="btn" data-testid="diag-copy" disabled={!report} onClick={() => void copy()}>
          {t('diag.copy')}
        </button>
      </div>
      {report && (
        <>
          <Section title={t('diag.gpu')}>
            {report.gpu?.software && <p className="prefs-warning">{t('diag.software')}</p>}
            <dl className="prefs-facts" data-testid="diag-gpu">
              <GpuLine label={t('prefs.gpu.default')} gpu={report.gpu} />
              {gpus > 1 && <GpuLine label={t('diag.gpuPower')} gpu={report.gpuHighPerformance} />}
              {gpus > 1 && <GpuLine label={t('diag.gpuSaver')} gpu={report.gpuLowPower} />}
              <dt>{t('diag.driver')}</dt>
              <dd>{report.gpu?.version ?? t('diag.none')}</dd>
              <dt>{t('diag.webgl')}</dt>
              <dd>
                {[report.webgl1 && 'WebGL 1', report.webgl2 && 'WebGL 2'].filter(Boolean).join(' · ') ||
                  t('diag.none')}
                {report.gpu?.maxTextureSize ? ` · ${report.gpu.maxTextureSize} px` : ''}
              </dd>
              <dt>{t('diag.webgpu')}</dt>
              <dd>{report.webgpu ?? t('diag.none')}</dd>
            </dl>
            {gpus > 1 && <p className="note small">{t('diag.gpus', { n: gpus })}</p>}
          </Section>
          {engine && (
            <Section title={t('prefs.engine')}>
              <dl className="prefs-facts" data-testid="diag-engine">
                <dt>WebAssembly</dt>
                <dd>
                  {engine.wasm.active
                    ? t('diag.engineWasm', {
                        version: engine.wasm.version ?? '?',
                        n: engine.wasm.calls,
                        ms: engine.wasm.meanMs.toFixed(1),
                      })
                    : t('diag.none')}
                </dd>
                {engine.native && (
                  <>
                    <dt>{t('prefs.engineGpu')}</dt>
                    <dd>
                      {engine.native.active
                        ? `${engine.native.active.name} · ${engine.native.active.backend} · ${engine.native.active.driver}`
                        : t('prefs.engineCpu', { n: engine.native.cores })}
                    </dd>
                    {Object.entries(engine.native.timings).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{t('diag.frameMs', { avg: v.meanMs.toFixed(0), max: v.maxMs.toFixed(0) })}</dd>
                      </Fragment>
                    ))}
                  </>
                )}
              </dl>
            </Section>
          )}
          <Section title={t('diag.render')}>
            <dl className="prefs-facts" data-testid="diag-render">
              <dt>{t('prefs.cache')}</dt>
              <dd>
                {t('diag.cacheUse', { used: render.usedMb, budget: render.budgetMb, n: render.entries })}
              </dd>
              <dt>{t('diag.frame')}</dt>
              <dd>{t('diag.frameMs', { avg: render.frameAvgMs, max: render.frameMaxMs })}</dd>
            </dl>
          </Section>
          <Section title={t('diag.system')}>
            <dl className="prefs-facts">
              <dt>{t('diag.system')}</dt>
              <dd>{report.platform}</dd>
              <dt>{t('diag.cpu')}</dt>
              <dd>
                {t('diag.cores', { n: report.cores })} · {t('prefs.threads')} : {report.threads}
              </dd>
              <dt>{t('diag.memory')}</dt>
              <dd>
                {formatMb(report.systemMemoryMb)}
                {report.usedMemoryMb !== null &&
                  ` · ${t('prefs.memoryUsed')} ${formatMb(report.usedMemoryMb)}`}
              </dd>
              <dt>{t('diag.screen')}</dt>
              <dd>{report.screen}</dd>
            </dl>
          </Section>
        </>
      )}
      <Section title={t('diag.bench')}>
        <p className="note small">{t('diag.benchNote')}</p>
        <div className="row-buttons">
          <button
            className="btn"
            data-testid="diag-bench"
            disabled={bench === 'running'}
            onClick={() => void runBench()}
          >
            {bench === 'running' ? t('diag.benchRunning') : t('diag.bench')}
          </button>
          {typeof bench === 'number' && (
            <span data-testid="diag-bench-result">{t('diag.benchResult', { fps: bench })}</span>
          )}
        </div>
      </Section>
    </>
  );
}
