import { useState } from 'react';
import { PHOTO_TOOL_KEYS, TOOL_KEYS } from '../commands';
import { useT } from '../i18n';
import { setSettings, useUi, type ToolId } from '../store';
import { PRESET_KEYS } from '../toolKeyPresets';

type App = 'photoshop' | 'illustrator';
const NAMES: Record<App, string> = { photoshop: 'Photoshop', illustrator: 'Illustrator' };

const keyOf = (keys: Record<string, ToolId[]>, id: ToolId) =>
  Object.entries(keys)
    .find(([, tools]) => tools.includes(id))?.[0]
    .toUpperCase() ?? '—';

/**
 * Aide > « Je viens de Photoshop / Illustrator » : correspondance des touches d'outils et des
 * idées principales, et un bouton pour prendre les touches de l'autre logiciel.
 */
export function HelpSwitch() {
  const t = useT();
  const [app, setApp] = useState<App>('photoshop');
  const preset = useUi((s) => s.settings.keyPreset);
  // Photoshop : outils photo ; Illustrator : outils vectoriels.
  const theirs = app === 'photoshop' ? PRESET_KEYS.photoshop.photo : PRESET_KEYS.illustrator.draw;
  const ours = app === 'photoshop' ? PHOTO_TOOL_KEYS : TOOL_KEYS;
  const tools = [...new Set(Object.values(theirs).flat())];
  const name = NAMES[app];
  return (
    <div data-testid="help-switch-body">
      <div className="seg" role="group" aria-label={t('switch.from')}>
        {(Object.keys(NAMES) as App[]).map((a) => (
          <button key={a} aria-pressed={app === a} data-testid={`switch-${a}`} onClick={() => setApp(a)}>
            {NAMES[a]}
          </button>
        ))}
      </div>
      <ul>
        {[1, 2, 3, 4].map((n) => (
          <li key={n}>{t(`switch.c${n}`)}</li>
        ))}
      </ul>
      <table className="switch-table" data-testid="switch-table">
        <thead>
          <tr>
            <th>{t('switch.tool')}</th>
            <th>{t('switch.theirKey', { app: name })}</th>
            <th>{t('switch.ourKey')}</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((id) => {
            const a = keyOf(theirs, id),
              b = keyOf(ours, id);
            return (
              <tr key={id} className={a !== b ? 'differs' : undefined}>
                <td>{t(`tool.${id}`)}</td>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {preset === app ? (
        <p className="note">
          {t('switch.using', { app: name })}{' '}
          <button className="link" onClick={() => setSettings({ keyPreset: 'affinity' })}>
            {t('switch.back')}
          </button>
        </p>
      ) : (
        <button
          className="btn primary"
          data-testid="switch-use"
          onClick={() => setSettings({ keyPreset: app })}
        >
          {t('switch.use', { app: name })}
        </button>
      )}
    </div>
  );
}
