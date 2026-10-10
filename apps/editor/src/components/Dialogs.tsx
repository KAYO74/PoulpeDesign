import { pickStartLanguage } from '../startLanguage';
import { useEffect, useRef, useState } from 'react';
import {
  FORMAT_PRESETS,
  defaultAdjustment,
  documentDpi,
  findFormat,
  mmToPx,
  printablePages,
  pxToMm,
  type Adjustment,
  type FormatCategory,
} from '@poulpe/core';
import { TEMPLATES } from '@poulpe/library';
import { discardDraft, getPendingDraft, restoreDraft } from '../drafts';
import { getLang, useT } from '../i18n';
import {
  batchExport,
  exportDocument,
  newDocument,
  openDocument,
  openPhoto,
  type BatchExportOptions,
  type ExportKind,
  type ExportOptions,
} from '../io';
import { AdjustmentFields } from '../panels/AdjustmentPanel';
import { applyFilter, previewFilter } from '../photo/photoActions';
import { modifySelection } from '../photo/selection';
import { setCanvasSize, setImageSize } from '../photo/retouchActions';
import { newFromTemplate, resizeDesign } from '../libraryActions';
import { TemplateCard } from '../panels/Library';
import { offsetPath } from '../vectorActions';
import { updateLayout } from '../layoutActions';
import { setSettings, ui, useEditor, useUi } from '../store';
import { NumberField, Select } from './fields';
import { Icon, type IconName } from './Icon';
import { TOOL_CATALOG, toolGroupsFor, toolPersona } from '../toolCatalog';
import { studioTabsAll } from '../panels/Studio';
import { createWorkspace, deleteWorkspace, editWorkspace, workspaces } from '../workspaces';
import type { Persona, ToolId, ToolsColumns } from '../store';
import { ShortcutsDialog } from './ShortcutsDialog';
import { UpdateDialog } from './UpdateDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { HelpDialog } from './HelpDialog';
import { ExtensionParamsDialog, ExtensionsDialog } from '../extensions/ExtensionsDialog';
import { VectorizeDialog } from '../smart/VectorizeDialog';

export function Modal({
  title,
  children,
  onClose,
  wide,
  xl,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  xl?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button.primary, button')?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal${wide ? ' wide' : ''}${xl ? ' xl' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="ib" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const close = () => ui.set({ dialog: null });

type NewSection = 'templates' | FormatCategory;

/**
 * Écran d'accueil et « Nouveau document » : modèles prêts à l'emploi, formats par usage (réseaux
 * sociaux, impression, écran) et taille personnalisée.
 */
function NewDialog() {
  const t = useT();
  const showWelcome = useUi((s) => s.settings.showWelcome);
  const [section, setSection] = useState<NewSection>('templates');
  const [preset, setPreset] = useState('portrait');
  const [size, setSize] = useState({ width: 1080, height: 1350 });
  const [format, setFormat] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [facing, setFacing] = useState(false);
  const print = section === 'print' || findFormat(preset)?.category === 'print';
  const create = (w: number, h: number, isPrint = print) =>
    newDocument(w, h, isPrint ? { dpi: 300, pages: pageCount, facing } : {});
  const formats = section === 'templates' ? [] : FORMAT_PRESETS.filter((f) => f.category === section);
  const templates = TEMPLATES.filter((d) => !format || d.format === format);
  const usedFormats = [...new Set(TEMPLATES.map((d) => d.format))];
  return (
    <Modal title={t('new.welcome')} onClose={close} xl>
      <div className="new-layout">
        <nav className="new-nav" aria-label={t('new.title')}>
          <button aria-pressed={section === 'templates'} onClick={() => setSection('templates')}>
            <Icon name="template" />
            {t('new.templates')}
          </button>
          <span className="new-nav-head">{t('new.formats')}</span>
          {(['social', 'print', 'screen'] as const).map((c) => (
            <button
              key={c}
              aria-pressed={section === c}
              data-testid={`new-${c}`}
              onClick={() => setSection(c)}
            >
              <Icon name={c === 'social' ? 'photo' : c === 'print' ? 'layout' : 'artboard'} />
              {t(`library.cat.${c}`)}
            </button>
          ))}
          <span className="spacer" />
          <button onClick={() => void openPhoto()} data-testid="welcome-open-photo">
            <Icon name="photo" />
            {t('new.openPhoto')}
          </button>
          <button onClick={() => void openDocument()}>
            <Icon name="folder" />
            {t('new.open')}
          </button>
        </nav>
        <div className="new-main">
          {section === 'templates' ? (
            <>
              <div className="chips" role="group">
                <button className="chip-btn" aria-pressed={format === null} onClick={() => setFormat(null)}>
                  {t('library.all')}
                </button>
                {usedFormats.map((f) => (
                  <button
                    key={f}
                    className="chip-btn"
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                  >
                    {t(`format.${f}`)}
                  </button>
                ))}
              </div>
              <div className="tpl-grid wide">
                {templates.map((d) => (
                  <TemplateCard key={d.id} def={d} onPick={newFromTemplate} />
                ))}
              </div>
            </>
          ) : (
            <div className="preset-grid">
              {formats.map((f) => (
                <button
                  key={f.id}
                  className={`preset${preset === f.id ? ' on' : ''}`}
                  data-testid={`preset-${f.id}`}
                  onClick={() => {
                    setPreset(f.id);
                    setSize({ width: f.width, height: f.height });
                  }}
                  onDoubleClick={() => create(f.width, f.height, f.category === 'print')}
                >
                  <span className="preset-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                  <b>{t(`format.${f.id}`)}</b>
                  <span className="num">
                    {f.width} × {f.height}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="new-footer">
        <label className="check">
          <input
            type="checkbox"
            checked={showWelcome}
            onChange={(e) => setSettings({ showWelcome: e.target.checked })}
          />
          {t('new.showAtStartup')}
        </label>
        <span className="spacer" />
        {print && (
          <>
            <NumberField
              label={t('new.pages')}
              value={pageCount}
              min={1}
              max={500}
              width={80}
              testId="new-pages"
              onChange={setPageCount}
            />
            <label className="check">
              <input type="checkbox" checked={facing} onChange={(e) => setFacing(e.target.checked)} />
              {t('docsetup.facing')}
            </label>
          </>
        )}
        <span className="muted">{t('new.custom2')}</span>
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={20000}
          unit="px"
          width={120}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, width: v }))}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={20000}
          unit="px"
          width={120}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, height: v }))}
        />
        <button
          className="btn primary"
          data-testid="new-create"
          onClick={() => create(size.width, size.height)}
        >
          {t('new.blank')}
        </button>
      </footer>
    </Modal>
  );
}

function ResizeDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const [size, setSize] = useState({ width: 1080, height: 1920 });
  const [preset, setPreset] = useState<string>('story');
  const [copy, setCopy] = useState(true);
  if (!ab) return null;
  return (
    <Modal title={t('resize.title')} onClose={close} wide>
      <p className="note">{t('resize.current', { w: Math.round(ab.width), h: Math.round(ab.height) })}</p>
      {(['social', 'print', 'screen'] as const).map((c) => (
        <div key={c}>
          <h4 className="sub">{t(`library.cat.${c}`)}</h4>
          <div className="preset-grid compact">
            {FORMAT_PRESETS.filter((f) => f.category === c).map((f) => (
              <button
                key={f.id}
                className={`preset${preset === f.id ? ' on' : ''}`}
                data-testid={`resize-${f.id}`}
                onClick={() => {
                  setPreset(f.id);
                  setSize({ width: f.width, height: f.height });
                }}
              >
                <span className="preset-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                <b>{t(`format.${f.id}`)}</b>
                <span className="num">
                  {f.width} × {f.height}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="picker-row">
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={20000}
          unit="px"
          width={130}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, width: v }))}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={20000}
          unit="px"
          width={130}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, height: v }))}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        {t('resize.copy')}
      </label>
      <p className="note small">{t('resize.hint')}</p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="resize-go"
          onClick={() =>
            resizeDesign(
              size.width,
              size.height,
              copy,
              preset !== 'custom' ? `${ab.name} · ${t(`format.${preset}`)}` : undefined,
            )
          }
        >
          <Icon name="resize" />
          {t('resize.go')}
        </button>
      </footer>
    </Modal>
  );
}

function ExportDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const pages = printablePages(doc);
  const bleed = doc.layout?.bleed ?? 0;
  const [opts, setOpts] = useState<ExportOptions>({
    kind: 'png',
    artboardId: activeArtboardId,
    scale: 1,
    quality: 0.92,
    transparent: false,
    pages: '',
    bleed: bleed > 0,
    marks: false,
    color: doc.layout?.colorMode === 'cmyk' ? 'cmyk' : 'rgb',
    pdfx: false,
  });
  const [busy, setBusy] = useState(false);
  const raster = opts.kind === 'png' || opts.kind === 'jpeg';
  const pdf = opts.kind === 'pdf';
  const mm = (px: number) => Math.round(pxToMm(doc, px) * 10) / 10;
  const ref = doc.artboards.find((a) => a.id === activeArtboardId) ?? pages[0];
  return (
    <Modal title={t('export.title')} onClose={close}>
      <div className="seg full" role="group" aria-label={t('export.format')}>
        {(['png', 'jpeg', 'svg', 'pdf', 'psd'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={opts.kind === k}
            data-testid={`export-${k}`}
            onClick={() =>
              setOpts({
                ...opts,
                kind: k,
                // Le PDF est un document de plusieurs pages : toutes les pages par défaut.
                artboardId: k === 'pdf' && pages.length > 1 ? 'all' : opts.artboardId,
              })
            }
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <Select
        label={t('export.artboard')}
        value={opts.artboardId}
        options={[
          ...doc.artboards.map((a) => ({
            value: a.id,
            label: `${a.name} · ${a.width} × ${a.height}${a.master ? ` (${t('pages.masterTag')})` : ''}`,
          })),
          ...(pages.length > 1 ? [{ value: 'all', label: t('export.allArtboards') }] : []),
          ...(pdf && pages.length > 1 ? [{ value: 'range', label: t('export.range') }] : []),
        ]}
        onChange={(v) => setOpts({ ...opts, artboardId: v })}
      />
      {pdf && opts.artboardId === 'range' && (
        <label className="field">
          <span className="field-label">{t('export.rangeLabel')}</span>
          <input
            className="text-input"
            data-testid="export-range"
            placeholder="1-3, 5"
            value={opts.pages}
            onChange={(e) => setOpts({ ...opts, pages: e.target.value })}
          />
        </label>
      )}
      {pdf && (
        <>
          <p className="note small">
            {t('export.printSize', {
              w: mm(ref.width),
              h: mm(ref.height),
              dpi: documentDpi(doc),
            })}
          </p>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-bleed"
              checked={opts.bleed}
              disabled={!bleed}
              onChange={(e) => setOpts({ ...opts, bleed: e.target.checked })}
            />
            {bleed ? t('export.bleed', { mm: mm(bleed) }) : t('export.noBleed')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-marks"
              checked={opts.marks}
              onChange={(e) => setOpts({ ...opts, marks: e.target.checked })}
            />
            {t('export.marks')}
          </label>
          <div className="picker-row">
            <Select
              label={t('export.colors')}
              value={opts.pdfx ? 'cmyk' : (opts.color ?? 'rgb')}
              options={[
                { value: 'rgb', label: t('docsetup.rgb') },
                { value: 'cmyk', label: t('docsetup.cmyk') },
              ]}
              onChange={(v) =>
                setOpts({ ...opts, color: v as 'rgb' | 'cmyk', pdfx: v === 'rgb' ? false : opts.pdfx })
              }
              width={200}
              testId="export-color"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-pdfx"
              checked={!!opts.pdfx}
              onChange={(e) =>
                setOpts({ ...opts, pdfx: e.target.checked, color: e.target.checked ? 'cmyk' : opts.color })
              }
            />
            {t('export.pdfx')}
          </label>
          {(opts.pdfx || opts.color === 'cmyk') && <p className="note small">{t('export.cmykHint')}</p>}
        </>
      )}
      {opts.kind === 'psd' && <p className="note small">{t('export.psdHint')}</p>}
      {raster && (
        <div className="picker-row">
          <Select
            label={t('export.scale')}
            value={opts.scale}
            options={[0.5, 1, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))}
            onChange={(v) => setOpts({ ...opts, scale: v })}
            width={110}
          />
          {opts.kind === 'jpeg' && (
            <NumberField
              label={t('export.quality')}
              value={Math.round(opts.quality * 100)}
              min={10}
              max={100}
              unit="%"
              width={110}
              onChange={(v) => setOpts({ ...opts, quality: v / 100 })}
            />
          )}
        </div>
      )}
      {(opts.kind === 'png' || opts.kind === 'svg') && (
        <label className="check">
          <input
            type="checkbox"
            checked={opts.transparent}
            onChange={(e) => setOpts({ ...opts, transparent: e.target.checked })}
          />
          {t('export.transparent')}
        </label>
      )}
      {opts.kind === 'pdf' && <p className="note">{t('export.pdfFonts')}</p>}
      <footer>
        <button className="btn" data-testid="export-batch" onClick={() => ui.set({ dialog: 'batch' })}>
          {t('export.batch')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="export-go"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportDocument(opts);
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="export" />
          {t('export.go')}
        </button>
      </footer>
    </Modal>
  );
}

/** Export par lots : plusieurs plans de travail, plusieurs formats et tailles, dans un fichier ZIP. */
function BatchDialog() {
  const t = useT();
  const { doc } = useEditor();
  const [opts, setOpts] = useState<BatchExportOptions>({
    artboardIds: doc.artboards.filter((a) => !a.master).map((a) => a.id),
    formats: ['png'],
    scales: [1, 2],
    quality: 0.92,
    transparent: false,
    cmyk: doc.layout?.colorMode === 'cmyk',
  });
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const raster = opts.formats.includes('png') || opts.formats.includes('jpeg');
  return (
    <Modal title={t('export.batchTitle')} onClose={close} wide>
      <p className="note">{t('export.batchHint')}</p>
      <h4 className="sub">{t('export.batchPages')}</h4>
      <div className="batch-list">
        {doc.artboards.map((a) => (
          <label key={a.id} className="check">
            <input
              type="checkbox"
              checked={opts.artboardIds.includes(a.id)}
              onChange={() => setOpts({ ...opts, artboardIds: toggle(opts.artboardIds, a.id) })}
            />
            {a.name}
            {a.master ? ` (${t('pages.masterTag')})` : ''}
          </label>
        ))}
      </div>
      <h4 className="sub">{t('export.format')}</h4>
      <div className="picker-row">
        {(['png', 'jpeg', 'svg', 'pdf', 'psd'] as ExportKind[]).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              data-testid={`batch-${k}`}
              checked={opts.formats.includes(k)}
              onChange={() => setOpts({ ...opts, formats: toggle(opts.formats, k) })}
            />
            {k.toUpperCase()}
          </label>
        ))}
      </div>
      {raster && (
        <>
          <h4 className="sub">{t('export.scale')}</h4>
          <div className="picker-row">
            {[0.5, 1, 2, 3, 4].map((sc) => (
              <label key={sc} className="check">
                <input
                  type="checkbox"
                  data-testid={`batch-scale-${sc}`}
                  checked={opts.scales.includes(sc)}
                  onChange={() => setOpts({ ...opts, scales: toggle(opts.scales, sc).sort((a, b) => a - b) })}
                />
                {sc}×
              </label>
            ))}
          </div>
        </>
      )}
      {opts.formats.includes('pdf') && (
        <label className="check">
          <input
            type="checkbox"
            checked={opts.cmyk}
            onChange={(e) => setOpts({ ...opts, cmyk: e.target.checked })}
          />
          {t('export.batchCmyk')}
        </label>
      )}
      <footer>
        <button className="btn" onClick={() => ui.set({ dialog: 'export' })}>
          {t('export.back')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="batch-go"
          disabled={busy || !opts.artboardIds.length || !opts.formats.length}
          onClick={async () => {
            setBusy(true);
            try {
              await batchExport(opts);
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="export" />
          {t('export.go')}
        </button>
      </footer>
    </Modal>
  );
}

/** Décalage du tracé : une copie du contour, agrandie ou rétrécie d'une distance donnée. */
function OffsetDialog() {
  const t = useT();
  const [distance, setDistance] = useState(10);
  const [join, setJoin] = useState<'round' | 'miter' | 'bevel'>('round');
  return (
    <Modal title={t('offset.title')} onClose={close}>
      <p className="note">{t('offset.hint')}</p>
      <div className="picker-row">
        <NumberField
          label={t('offset.distance')}
          value={distance}
          min={-1000}
          max={1000}
          decimals={1}
          unit="px"
          width={130}
          testId="offset-distance"
          onChange={setDistance}
        />
        <Select
          label={t('stroke.join')}
          value={join}
          options={(['round', 'miter', 'bevel'] as const).map((j) => ({
            value: j,
            label: t(`stroke.join.${j}`),
          }))}
          onChange={setJoin}
        />
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="offset-go"
          onClick={() => {
            close();
            offsetPath(distance, join);
          }}
        >
          {t('offset.go')}
        </button>
      </footer>
    </Modal>
  );
}

/**
 * Réglages du document (comme « Configuration du document » d'Affinity Publisher) : résolution,
 * pages en vis-à-vis, numérotation, marges et fond perdu. Les longueurs se règlent en millimètres.
 */
function DocumentDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const layout = doc.layout ?? {};
  const [dpi, setDpi] = useState(documentDpi(doc));
  const asDoc = { layout: { dpi } };
  const toMm = (px: number) => Math.round(pxToMm(asDoc, px) * 10) / 10;
  const [facing, setFacing] = useState(!!layout.facing);
  const [first, setFirst] = useState(layout.firstNumber ?? 1);
  const [showMargins, setShowMargins] = useState(!!layout.margins);
  const m = layout.margins;
  const defaultMargin = Math.round(pxToMm(doc, (doc.artboards[0]?.width ?? 1000) * 0.06));
  const [margins, setMargins] = useState({
    top: m ? toMm(m.top) : defaultMargin,
    bottom: m ? toMm(m.bottom) : defaultMargin,
    inside: m ? toMm(m.inside) : defaultMargin,
    outside: m ? toMm(m.outside) : defaultMargin,
  });
  const [bleed, setBleed] = useState(layout.bleed ? toMm(layout.bleed) : 0);
  const [colorMode, setColorMode] = useState<'rgb' | 'cmyk'>(layout.colorMode ?? 'rgb');
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const px = (v: number) => Math.round(mmToPx(asDoc, v) * 100) / 100;
  const field = (key: keyof typeof margins, label: string) => (
    <NumberField
      label={label}
      value={margins[key]}
      min={0}
      max={1000}
      decimals={1}
      unit="mm"
      width={110}
      disabled={!showMargins}
      testId={`margin-${key}`}
      onChange={(v) => setMargins({ ...margins, [key]: v })}
    />
  );
  return (
    <Modal title={t('docsetup.title')} onClose={close} wide>
      <div className="picker-row">
        <Select
          label={t('docsetup.dpi')}
          value={[72, 96, 150, 300, 600].includes(dpi) ? dpi : 0}
          options={[
            ...[72, 96, 150, 300, 600].map((v) => ({ value: v, label: `${v} ${t('docsetup.ppi')}` })),
            ...([72, 96, 150, 300, 600].includes(dpi)
              ? []
              : [{ value: 0, label: `${dpi} ${t('docsetup.ppi')}` }]),
          ]}
          onChange={(v) => v && setDpi(v)}
          width={140}
        />
        {ab && (
          <p className="note small grow">
            {t('docsetup.size', { w: toMm(ab.width), h: toMm(ab.height), pw: ab.width, ph: ab.height })}
          </p>
        )}
      </div>
      <p className="note small">{t('docsetup.dpiHint')}</p>
      <h4 className="sub">{t('docsetup.pages')}</h4>
      <div className="picker-row">
        <label className="check">
          <input
            type="checkbox"
            data-testid="doc-facing"
            checked={facing}
            onChange={(e) => setFacing(e.target.checked)}
          />
          {t('docsetup.facing')}
        </label>
        <NumberField
          label={t('docsetup.firstNumber')}
          value={first}
          min={1}
          max={9999}
          width={110}
          onChange={setFirst}
        />
      </div>
      <h4 className="sub">{t('docsetup.margins')}</h4>
      <label className="check">
        <input
          type="checkbox"
          data-testid="doc-margins"
          checked={showMargins}
          onChange={(e) => setShowMargins(e.target.checked)}
        />
        {t('docsetup.showMargins')}
      </label>
      <div className="picker-row">
        {field('top', t('docsetup.top'))}
        {field('bottom', t('docsetup.bottom'))}
        {field('inside', facing ? t('docsetup.inside') : t('docsetup.left'))}
        {field('outside', facing ? t('docsetup.outside') : t('docsetup.right'))}
      </div>
      <h4 className="sub">{t('docsetup.bleed')}</h4>
      <div className="picker-row">
        <NumberField
          label={t('docsetup.bleedAll')}
          value={bleed}
          min={0}
          max={100}
          decimals={1}
          unit="mm"
          width={110}
          testId="doc-bleed"
          onChange={setBleed}
        />
        <p className="note small grow">{t('docsetup.bleedHint')}</p>
      </div>
      <h4 className="sub">{t('docsetup.colors')}</h4>
      <div className="picker-row">
        <Select
          label={t('docsetup.colorMode')}
          value={colorMode}
          options={[
            { value: 'rgb', label: t('docsetup.rgb') },
            { value: 'cmyk', label: t('docsetup.cmyk') },
          ]}
          onChange={(v) => setColorMode(v as 'rgb' | 'cmyk')}
          width={200}
          testId="doc-color"
        />
        <p className="note small grow">{t('docsetup.colorHint')}</p>
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="doc-apply"
          onClick={() => {
            updateLayout({
              dpi,
              facing: facing || undefined,
              firstNumber: first !== 1 ? first : undefined,
              colorMode: colorMode === 'cmyk' ? 'cmyk' : undefined,
              bleed: bleed > 0 ? px(bleed) : undefined,
              margins: showMargins
                ? {
                    top: px(margins.top),
                    bottom: px(margins.bottom),
                    inside: px(margins.inside),
                    outside: px(margins.outside),
                  }
                : undefined,
            });
            close();
          }}
        >
          {t('docsetup.apply')}
        </button>
      </footer>
    </Modal>
  );
}

/** Filtre appliqué aux pixels du calque choisi, avec aperçu en direct. */
function FilterDialog() {
  const t = useT();
  const kind = useUi((s) => s.filterKind);
  const [adj, setAdj] = useState<Adjustment>(() => defaultAdjustment(kind ?? 'gaussianBlur'));
  const [preview, setPreview] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => previewFilter(preview ? adj : null), 120);
    return () => clearTimeout(id);
  }, [adj, preview]);
  useEffect(() => () => previewFilter(null), []);
  if (!kind) return null;
  const cancel = () => {
    previewFilter(null);
    close();
  };
  return (
    <Modal title={t(`adjust.${kind}`)} onClose={cancel}>
      <p className="note">{t('filter.hint')}</p>
      <AdjustmentFields adj={adj} onChange={setAdj} />
      <footer>
        <label className="check">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
          {t('filter.preview')}
        </label>
        <span className="spacer" />
        <button className="btn" onClick={cancel}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="filter-apply"
          onClick={() => {
            close();
            void applyFilter(adj);
          }}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}

/** Adoucir, agrandir ou réduire la sélection de pixels. */
function SelectionModifyDialog() {
  const t = useT();
  const kind = useUi((s) => s.selectionModify) ?? 'feather';
  const [radius, setRadius] = useState(kind === 'feather' ? 10 : 5);
  return (
    <Modal title={t(`selmod.${kind}`)} onClose={close}>
      <div className="picker-row">
        <NumberField
          label={t('selmod.radius')}
          value={radius}
          min={0}
          max={500}
          decimals={1}
          unit="px"
          width={130}
          onChange={setRadius}
        />
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            close();
            modifySelection(kind, radius);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}

/** Taille de l'image : tout le contenu du plan de travail est mis à l'échelle. */
function ImageSizeDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const [size, setSize] = useState({
    width: Math.round(ab?.width ?? 1),
    height: Math.round(ab?.height ?? 1),
  });
  const [keep, setKeep] = useState(true);
  const [resample, setResample] = useState(true);
  if (!ab) return null;
  const ratio = ab.width / ab.height;
  return (
    <Modal title={t('document.imageSize').replace('…', '')} onClose={close}>
      <p className="note">{t('size.current', { w: Math.round(ab.width), h: Math.round(ab.height) })}</p>
      <div className="picker-row">
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) =>
            setSize({ width: v, height: keep ? Math.max(1, Math.round(v / ratio)) : size.height })
          }
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) =>
            setSize({ width: keep ? Math.max(1, Math.round(v * ratio)) : size.width, height: v })
          }
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        {t('size.keepRatio')}
      </label>
      <label className="check">
        <input type="checkbox" checked={resample} onChange={(e) => setResample(e.target.checked)} />
        {t('size.resample')}
      </label>
      <p className="note small">
        {t('size.imageHint')} {resample ? t('size.resampleHint') : ''}
      </p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="image-size-ok"
          onClick={() => {
            close();
            void setImageSize(size.width, size.height, resample);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}

/** Taille de la zone de travail : le plan de travail change de taille autour d'un point d'ancrage. */
function CanvasSizeDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const [size, setSize] = useState({
    width: Math.round(ab?.width ?? 1),
    height: Math.round(ab?.height ?? 1),
  });
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  if (!ab) return null;
  return (
    <Modal title={t('document.canvasSize').replace('…', '')} onClose={close}>
      <p className="note">{t('size.current', { w: Math.round(ab.width), h: Math.round(ab.height) })}</p>
      <div className="picker-row">
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) => setSize({ ...size, width: v })}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) => setSize({ ...size, height: v })}
        />
        <span className="field">
          <span className="field-label">{t('size.anchor')}</span>
          <span className="anchor-grid" role="group" aria-label={t('size.anchor')}>
            {[0, 0.5, 1].map((y) =>
              [0, 0.5, 1].map((x) => (
                <button
                  key={`${x}-${y}`}
                  className="anchor-cell"
                  aria-pressed={anchor[0] === x && anchor[1] === y}
                  aria-label={`${x} ${y}`}
                  onClick={() => setAnchor([x, y])}
                />
              )),
            )}
          </span>
        </span>
      </div>
      <p className="note small">{t('size.canvasHint')}</p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="canvas-size-ok"
          onClick={() => {
            close();
            setCanvasSize(size.width, size.height, anchor[0], anchor[1]);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}

function AboutDialog() {
  const t = useT();
  return (
    <Modal title={t('help.about')} onClose={close}>
      <p>{t('help.aboutText', { version: __APP_VERSION__ })}</p>
    </Modal>
  );
}

/** Premier lancement de l'appli de bureau sans langue choisie à l'installation. */
function LanguageDialog() {
  const lang = getLang();
  return (
    <Modal title="Langue · Language" onClose={() => pickStartLanguage(lang)}>
      <p>
        Choisissez la langue de Poulpe Design.
        <br />
        Choose the language of Poulpe Design.
      </p>
      <p className="note">
        Vous pourrez la changer dans Édition &gt; Préférences.
        <br />
        You can change it later in Edit &gt; Preferences.
      </p>
      <footer>
        <button
          className={`btn${lang === 'fr' ? ' primary' : ''}`}
          data-testid="start-lang-fr"
          onClick={() => pickStartLanguage('fr')}
        >
          Français
        </button>
        <button
          className={`btn${lang === 'en' ? ' primary' : ''}`}
          data-testid="start-lang-en"
          onClick={() => pickStartLanguage('en')}
        >
          English
        </button>
      </footer>
    </Modal>
  );
}

function DraftDialog() {
  const t = useT();
  const draft = getPendingDraft();
  if (!draft) return null;
  const date = new Date(draft.savedAt).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <Modal title={t('draft.title')} onClose={discardDraft}>
      <p>{t('draft.body', { name: draft.doc.name, date })}</p>
      <footer>
        <button className="btn" onClick={discardDraft}>
          {t('draft.discard')}
        </button>
        <button className="btn primary" data-testid="draft-restore" onClick={restoreDraft}>
          {t('draft.restore')}
        </button>
      </footer>
    </Modal>
  );
}

const BASES: { id: Persona; icon: IconName }[] = [
  { id: 'draw', icon: 'draw' },
  { id: 'photo', icon: 'photo' },
  { id: 'layout', icon: 'layout' },
];

/**
 * Créer ou modifier un espace de travail personnalisé : nom, base (vectoriel, pixel, présentation),
 * outils et panneaux affichés. La disposition actuelle des panneaux est enregistrée avec l'espace.
 */
function WorkspaceDialog() {
  const t = useT();
  const editId = useUi((s) => s.workspaceEdit);
  const existing = workspaces.get().list.find((w) => w.id === editId) ?? null;
  const persona = useUi((s) => s.persona);
  const columnsNow = useUi((s) => s.settings.toolsColumns);
  const [name, setName] = useState(existing?.name ?? t('workspace.defaultName'));
  const [base, setBase] = useState<Persona>(existing?.base ?? persona);
  const all = TOOL_CATALOG.flatMap((c) => c.tools);
  const allTabs = studioTabsAll().map((tab) => tab.id);
  const baseTools = (b: Persona) => toolGroupsFor(b).flat();
  const [tools, setTools] = useState<ToolId[]>(existing?.tools ?? baseTools(existing?.base ?? persona));
  const [tabs, setTabs] = useState<string[]>(existing?.tabs ?? allTabs);
  const [columns, setColumns] = useState<ToolsColumns>(existing?.toolsColumns ?? columnsNow);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const changeBase = (b: Persona) => {
    setBase(b);
    setTools(baseTools(b));
  };
  const mixed =
    tools.some((id) => toolPersona(id) === 'photo') && tools.some((id) => toolPersona(id) === 'draw');
  const save = () => {
    const keptTools = all.filter((id) => tools.includes(id));
    const keptTabs = allTabs.filter((id) => tabs.includes(id));
    const same = (a: ToolId[], b: ToolId[]) => a.length === b.length && a.every((id) => b.includes(id));
    const draft = {
      name: name.trim() || t('workspace.defaultName'),
      base,
      tools: same(keptTools, baseTools(base)) ? null : keptTools,
      tabs: keptTabs.length === allTabs.length ? null : keptTabs,
      toolsColumns: columns,
    };
    if (existing) editWorkspace(existing.id, draft);
    else createWorkspace(draft);
    close();
  };
  return (
    <Modal title={t(existing ? 'workspace.editTitle' : 'workspace.newTitle')} onClose={close} wide>
      <label className="ws-name">
        <span>{t('workspace.name')}</span>
        <input
          className="text-input"
          value={name}
          data-testid="workspace-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <h4 className="sub">{t('workspace.base')}</h4>
      <div className="ws-bases" role="radiogroup" aria-label={t('workspace.base')}>
        {BASES.map((b) => (
          <button
            key={b.id}
            role="radio"
            aria-checked={base === b.id}
            className={`ws-base${base === b.id ? ' on' : ''}`}
            data-testid={`workspace-base-${b.id}`}
            onClick={() => changeBase(b.id)}
          >
            <Icon name={b.icon} />
            <b>{t(`workspace.base.${b.id}`)}</b>
            <span>{t(`workspace.baseHint.${b.id}`)}</span>
          </button>
        ))}
      </div>
      <h4 className="sub">
        {t('workspace.tools')}
        <span className="ws-count">
          {tools.length} / {all.length}
        </span>
        <button className="link" onClick={() => setTools(baseTools(base))}>
          {t('workspace.baseTools')}
        </button>
        <button className="link" onClick={() => setTools(all)}>
          {t('workspace.all')}
        </button>
        <button className="link" onClick={() => setTools(['select'])}>
          {t('workspace.none')}
        </button>
      </h4>
      <p className="note small">{t('workspace.toolsHint')}</p>
      <div className="ws-catalog">
        {TOOL_CATALOG.map((family) => (
          <div className="ws-family" key={family.id}>
            <span className="ws-family-name">{t(`workspace.family.${family.id}`)}</span>
            <div className="ws-toolgroup">
              {family.tools.map((id) => (
                <button
                  key={id}
                  className="tool"
                  aria-pressed={tools.includes(id)}
                  title={t(`tool.${id}`)}
                  aria-label={t(`tool.${id}`)}
                  data-testid={`workspace-tool-${id}`}
                  onClick={() => setTools(toggle(tools, id))}
                >
                  <Icon name={id as IconName} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {mixed && <p className="note small">{t('workspace.mixedHint')}</p>}
      <h4 className="sub">{t('view.toolsColumns')}</h4>
      <div className="seg" role="group" aria-label={t('view.toolsColumns')}>
        {(['auto', 'one', 'two'] as const).map((c) => (
          <button
            key={c}
            aria-pressed={columns === c}
            data-testid={`workspace-columns-${c}`}
            onClick={() => setColumns(c)}
          >
            {t(`view.toolsColumns.${c}`)}
          </button>
        ))}
      </div>
      <h4 className="sub">{t('workspace.panels')}</h4>
      <div className="ws-tabs">
        {studioTabsAll().map((tab) => (
          <label className="check" key={tab.id}>
            <input
              type="checkbox"
              checked={tabs.includes(tab.id)}
              data-testid={`workspace-tab-${tab.id}`}
              onChange={() => setTabs(toggle(tabs, tab.id))}
            />
            {t(tab.label)}
          </label>
        ))}
      </div>
      <p className="note small">{t('workspace.layoutHint')}</p>
      <footer>
        {existing && (
          <button
            className="btn danger"
            data-testid="workspace-delete"
            onClick={() => {
              deleteWorkspace(existing.id);
              close();
            }}
          >
            <Icon name="trash" />
            {t('workspace.delete')}
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="workspace-save" onClick={save}>
          {t(existing ? 'workspace.save' : 'workspace.create')}
        </button>
      </footer>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (dialog === 'new') return <NewDialog />;
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'draft') return <DraftDialog />;
  if (dialog === 'language') return <LanguageDialog />;
  if (dialog === 'resize') return <ResizeDialog />;
  if (dialog === 'offset') return <OffsetDialog />;
  if (dialog === 'document') return <DocumentDialog />;
  if (dialog === 'batch') return <BatchDialog />;
  if (dialog === 'filter') return <FilterDialog />;
  if (dialog === 'selectionModify') return <SelectionModifyDialog />;
  if (dialog === 'vectorize') return <VectorizeDialog />;
  if (dialog === 'extensions') return <ExtensionsDialog />;
  if (dialog === 'extensionParams') return <ExtensionParamsDialog />;
  if (dialog === 'update') return <UpdateDialog />;
  if (dialog === 'imageSize') return <ImageSizeDialog />;
  if (dialog === 'canvasSize') return <CanvasSizeDialog />;
  if (dialog === 'workspace') return <WorkspaceDialog />;
  if (dialog === 'preferences') return <PreferencesDialog />;
  if (dialog === 'help') return <HelpDialog />;
  return null;
}
