import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import {
  cancelPanorama,
  canPanorama,
  DEFAULT_PANORAMA,
  stitchSelected,
  type PanoramaSettings,
} from '../../smart/panorama';
import { Modal } from './Modal';
import { close } from './close';

/* Panorama : les photos choisies, qui se recouvrent, donnent une nouvelle image. */

export function PanoramaDialog() {
  const t = useT();
  const [s, setS] = useState<PanoramaSettings>(DEFAULT_PANORAMA);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState('');
  // Fenêtre fermée pendant le calcul : on l'arrête.
  useEffect(() => cancelPanorama, []);

  const run = async () => {
    setBusy(true);
    setDone(0);
    setStatus('');
    try {
      const ok = await stitchSelected(s, setDone);
      if (ok) close();
      else setStatus(t('panorama.cancelled'));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('panorama.title')} onClose={close}>
      <p className="hint">{t('panorama.hint')}</p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="panorama-exposure"
          checked={s.exposure}
          disabled={busy}
          onChange={(e) => setS({ ...s, exposure: e.target.checked })}
        />
        {t('panorama.exposure')}
      </label>
      {busy && (
        <div className="picker-row">
          <progress max={1} value={done} data-testid="panorama-progress" aria-label={t('panorama.working')} />
          <button className="btn small" data-testid="panorama-cancel" onClick={cancelPanorama}>
            {t('new.cancel')}
          </button>
        </div>
      )}
      {status && (
        <p className="note" data-testid="panorama-status">
          {status}
        </p>
      )}
      <footer>
        <button className="btn" onClick={close}>
          {t('common.close')}
        </button>
        <button
          className="btn primary"
          data-testid="panorama-run"
          disabled={busy || !canPanorama()}
          onClick={() => void run()}
        >
          {t('panorama.run')}
        </button>
      </footer>
    </Modal>
  );
}
