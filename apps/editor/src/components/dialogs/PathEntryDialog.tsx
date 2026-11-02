import { useState } from 'react';
import { pathEntryMode, applyPath } from '../../io';
import { useT } from '../../i18n';
import { Modal } from './Modal';
import { close } from './close';

/** Coller le chemin d'un fichier à ouvrir ou sous lequel enregistrer (appli de bureau). */
export function PathEntryDialog() {
  const t = useT();
  const mode = pathEntryMode();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const go = async () => {
    if (!path.trim()) return;
    const e = await applyPath(path, mode);
    if (e) setError(e);
  };
  return (
    <Modal title={t(mode === 'open' ? 'path.title.open' : 'path.title.save')} onClose={close}>
      <p className="note">{t('path.hint')}</p>
      <input
        autoFocus
        className="input"
        value={path}
        data-testid="path-input"
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void go()}
      />
      {error && (
        <p className="note" role="alert" data-testid="path-error">
          {t('path.error', { e: error })}
        </p>
      )}
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          disabled={!path.trim()}
          onClick={() => void go()}
          data-testid="path-go"
        >
          {t(mode === 'open' ? 'file.open' : 'file.save')}
        </button>
      </footer>
    </Modal>
  );
}
