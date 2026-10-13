import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/*
 * Boutons réduire, agrandir (ou restaurer) et fermer de la barre de titre, dans l'appli de bureau
 * sous Windows et Linux, où l'éditeur dessine sa propre barre de titre.
 */

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void win()
      .then(async (w) => {
        const update = () => void w.isMaximized().then((m) => !gone && setMaximized(m));
        update();
        const unlisten = await w.onResized(update);
        if (gone) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  const maxLabel = t(maximized ? 'window.restore' : 'window.maximize');
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-btn"
        title={t('window.minimize')}
        aria-label={t('window.minimize')}
        data-testid="window-minimize"
        onClick={() => void win().then((w) => w.minimize())}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5.5h8" />
        </svg>
      </button>
      <button
        type="button"
        className="window-btn"
        title={maxLabel}
        aria-label={maxLabel}
        data-testid="window-maximize"
        onClick={() => void win().then((w) => w.toggleMaximize())}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          {maximized ? <path d="M1.5 3.5h5v5h-5z M3.5 3.5v-2h5v5h-2" /> : <path d="M1.5 1.5h7v7h-7z" />}
        </svg>
      </button>
      <button
        type="button"
        className="window-btn close"
        title={t('window.close')}
        aria-label={t('window.close')}
        data-testid="window-close"
        onClick={() => void win().then((w) => w.close())}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7 M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
