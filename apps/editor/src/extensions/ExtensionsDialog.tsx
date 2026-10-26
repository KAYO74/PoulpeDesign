import { useState } from 'react';
import { Modal } from '../components/Dialogs';
import { NumberField, Select } from '../components/fields';
import { useT } from '../i18n';
import { pickFile } from '../io';
import { ui, useStore } from '../store';
import { brushPacks, uninstallPack } from '../tools/brushes/packs';
import { installBrushes } from '../tools/brushes/BrushPresets';
import {
  inspectExtension,
  installExtension,
  localized,
  pendingParams,
  runExtensionCommand,
  setExtensionEnabled,
  uninstallExtension,
  useExtensions,
  type ExtensionManifest,
} from './host';
import grid from './examples/grid.js?raw';
import rosette from './examples/rosette.js?raw';
import shuffle from './examples/shuffle.js?raw';

const close = () => ui.set({ dialog: null });

/** Extensions d'exemple livrées avec Poulpe (à installer d'un clic). */
const EXAMPLES: { id: string; source: string }[] = [
  { id: 'org.poulpe.grid', source: grid },
  { id: 'org.poulpe.shuffle', source: shuffle },
  { id: 'org.poulpe.rosette', source: rosette },
];

/** Extensions > Gérer les extensions… */
export function ExtensionsDialog() {
  const t = useT();
  const list = useExtensions();
  const [pending, setPending] = useState<{
    manifest: ExtensionManifest;
    commands: string[];
    source: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = async (source: string) => {
    setError(null);
    try {
      setPending({ ...(await inspectExtension(source)), source });
    } catch (e) {
      setError(t('ext.invalid', { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const fromFile = async () => {
    const file = await pickFile(['js'], '.js,text/javascript');
    if (file) await review(new TextDecoder().decode(file.bytes));
  };

  return (
    <Modal title={t('ext.title')} onClose={close} wide>
      <p className="note">{t('ext.intro')}</p>
      {pending ? (
        <div className="ext-review" data-testid="ext-review">
          <h3>
            {pending.manifest.name} <span className="muted">{pending.manifest.version}</span>
          </h3>
          {pending.manifest.description && <p>{pending.manifest.description}</p>}
          {pending.manifest.author && (
            <p className="muted">{t('ext.author', { name: pending.manifest.author })}</p>
          )}
          <p>{t('ext.commands', { list: pending.commands.join(', ') || '—' })}</p>
          <p className="note small">{t('ext.safety')}</p>
          <footer>
            <button className="btn" onClick={() => setPending(null)}>
              {t('new.cancel')}
            </button>
            <button
              className="btn primary"
              data-testid="ext-install"
              onClick={async () => {
                try {
                  await installExtension(pending.source);
                  setPending(null);
                } catch (e) {
                  setError(t('ext.invalid', { message: e instanceof Error ? e.message : String(e) }));
                }
              }}
            >
              {t('ext.install')}
            </button>
          </footer>
        </div>
      ) : (
        <>
          <section>
            <h3>{t('ext.installed')}</h3>
            {list.length === 0 && <p className="muted">{t('ext.none')}</p>}
            <ul className="ext-list">
              {list.map((e) => (
                <li key={e.manifest.id} data-testid={`ext-${e.manifest.id}`}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={e.enabled}
                      aria-label={t('ext.enabled')}
                      onChange={(ev) => void setExtensionEnabled(e.manifest.id, ev.target.checked)}
                    />
                    <span>
                      <b>{e.manifest.name}</b> <span className="muted">{e.manifest.version}</span>
                      {e.manifest.description && <span className="ext-desc">{e.manifest.description}</span>}
                    </span>
                  </label>
                  <button className="btn" onClick={() => uninstallExtension(e.manifest.id)}>
                    {t('ext.remove')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <BrushPacksSection />
          <section>
            <h3>{t('ext.examples')}</h3>
            <ul className="ext-list">
              {EXAMPLES.filter((x) => !list.some((e) => e.manifest.id === x.id)).map((x) => (
                <li key={x.id}>
                  <span>{x.id}</span>
                  <button
                    className="btn"
                    data-testid={`ext-example-${x.id}`}
                    onClick={() => void review(x.source)}
                  >
                    {t('ext.see')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button className="btn" onClick={() => void fromFile()}>
              {t('ext.fromFile')}
            </button>
            <span className="spacer" />
            <button className="btn primary" onClick={close}>
              {t('common.close')}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}

/** Paramètres d'une commande d'extension, demandés avant de la lancer. */
export function ExtensionParamsDialog() {
  const t = useT();
  const info = pendingParams;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries((info?.command.params ?? []).map((p) => [p.id, p.default ?? defaultFor(p.type)])),
  );
  if (!info) return null;
  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  return (
    <Modal title={localized(info.command.title).replace(/…$/, '')} onClose={close}>
      <div className="ext-params">
        {(info.command.params ?? []).map((p) => {
          const label = localized(p.label);
          switch (p.type) {
            case 'number':
              return (
                <NumberField
                  key={p.id}
                  label={label}
                  value={Number(values[p.id])}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  decimals={2}
                  width={130}
                  testId={`param-${p.id}`}
                  onChange={(v) => set(p.id, v)}
                />
              );
            case 'boolean':
              return (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={!!values[p.id]}
                    onChange={(e) => set(p.id, e.target.checked)}
                  />
                  {label}
                </label>
              );
            case 'color':
              return (
                <label key={p.id} className="field">
                  <span className="field-label">{label}</span>
                  <input
                    type="color"
                    value={String(values[p.id])}
                    onChange={(e) => set(p.id, e.target.value)}
                  />
                </label>
              );
            case 'select':
              return (
                <Select
                  key={p.id}
                  label={label}
                  value={String(values[p.id])}
                  options={(p.options ?? []).map((o) => ({
                    value: String(o.value),
                    label: localized(o.label),
                  }))}
                  onChange={(v) => set(p.id, v)}
                />
              );
            default:
              return (
                <label key={p.id} className="field">
                  <span className="field-label">{label}</span>
                  <input
                    type="text"
                    value={String(values[p.id] ?? '')}
                    onChange={(e) => set(p.id, e.target.value)}
                  />
                </label>
              );
          }
        })}
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="ext-run"
          onClick={() => {
            close();
            runExtensionCommand(info.extension, info.command.id, values);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}

function defaultFor(type: string): unknown {
  return type === 'number' ? 0 : type === 'boolean' ? false : type === 'color' ? '#000000' : '';
}

/** Paquets de pinceaux installés (version 1.2.9) : ils se gèrent comme les extensions. */
function BrushPacksSection() {
  const t = useT();
  const packs = useStore(brushPacks, (s) => s.list);
  return (
    <section>
      <h3>{t('brushPacks.title')}</h3>
      {packs.length === 0 && <p className="muted">{t('brushPacks.none')}</p>}
      <ul className="ext-list">
        {packs.map((p) => (
          <li key={p.id} data-testid={`brush-pack-${p.name}`}>
            <span>
              <b>{p.name}</b>{' '}
              <span className="muted">{t('brushPacks.count', { n: p.presetIds.length })}</span>
              {p.author && <span className="ext-desc">{t('ext.author', { name: p.author })}</span>}
            </span>
            <button className="btn" onClick={() => uninstallPack(p.id)}>
              {t('ext.remove')}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn" data-testid="ext-brushes-install" onClick={() => void installBrushes(t)}>
        {t('brushPacks.install')}
      </button>
    </section>
  );
}
