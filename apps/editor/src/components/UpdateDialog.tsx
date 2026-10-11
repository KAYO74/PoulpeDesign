import { useState } from 'react';
import { useT } from '../i18n';
import { setSettings, ui, useUi } from '../store';
import { installUpdate, pendingUpdate } from '../updater';
import { Modal } from './Dialogs';

const close = () => ui.set({ updateOpen: false });

/**
 * Petite fenêtre au centre : une nouvelle version est disponible. Installer la télécharge et
 * redémarre Poulpe Design ; les nouveautés se déplient au besoin.
 */
export function UpdateDialog() {
  const t = useT();
  const open = useUi((s) => s.updateOpen);
  const auto = useUi((s) => s.settings.autoUpdate);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const info = pendingUpdate();
  if (!open || !info) return null;
  const busy = progress !== undefined && !failed;
  return (
    <Modal title={t('update.title')} onClose={() => !busy && close()} small top>
      <p>{t('update.available', { version: info.version, current: info.current })}</p>
      {info.notes && (
        <details className="update-details">
          <summary>{t('update.notes')}</summary>
          <pre className="update-notes">{info.notes}</pre>
        </details>
      )}
      {busy && (
        <p className="update-progress" role="status">
          {t('update.downloading')}
          {progress !== null && ` ${Math.round(progress * 100)} %`}
        </p>
      )}
      {failed && (
        <p className="error" role="alert">
          {t('update.error')}
        </p>
      )}
      <footer>
        <label className="check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setSettings({ autoUpdate: e.target.checked })}
          />
          {t('update.auto')}
        </label>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={close}>
          {t('update.later')}
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setFailed(false);
            setProgress(null);
            installUpdate(setProgress).catch((e) => {
              console.error(e);
              setFailed(true);
            });
          }}
        >
          {t('update.install')}
        </button>
      </footer>
    </Modal>
  );
}
