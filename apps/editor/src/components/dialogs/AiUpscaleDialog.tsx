import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import {
  applyAiUpscale,
  closeAiUpscale,
  toastUpscaleFailed,
  UPSCALE_MAX_OUTPUT,
  upscaleSource,
} from '../../photo/aiUpscale';
import { Modal } from './Modal';

/** Agrandir par IA : facteur (×2 ou ×4), taille avant et après, progression. */
export function AiUpscaleDialog() {
  const t = useT();
  const [factor, setFactor] = useState<2 | 4>(2);
  const [busy, setBusy] = useState<number | null>(null);
  const stop = useRef(false);
  const src = upscaleSource();
  const tooBig = !!src && src.width * src.height * 16 > UPSCALE_MAX_OUTPUT;
  const cancel = () => {
    stop.current = true;
    closeAiUpscale();
  };
  const apply = async () => {
    stop.current = false;
    setBusy(0);
    try {
      const ok = await applyAiUpscale(factor, setBusy, () => stop.current);
      if (!ok && !stop.current) toastUpscaleFailed(false);
    } catch (e) {
      console.error(e);
      toastUpscaleFailed(e instanceof Error && e.message === 'model-missing');
    }
    if (!stop.current) closeAiUpscale();
  };
  return (
    <Modal title={t('aiupscale.title')} onClose={cancel}>
      <p className="note">{t('aiupscale.hint')}</p>
      <div className="seg" role="group" aria-label={t('aiupscale.factor')}>
        {([2, 4] as const).map((f) => (
          <button
            key={f}
            aria-pressed={factor === f}
            disabled={busy !== null}
            data-testid={`aiupscale-x${f}`}
            onClick={() => setFactor(f)}
          >
            ×{f}
          </button>
        ))}
      </div>
      {src && (
        <p className="note" data-testid="aiupscale-size">
          {src.width} × {src.height} px → {src.width * factor} × {src.height * factor} px
        </p>
      )}
      {tooBig && <p className="note">{t('aiupscale.tooBig')}</p>}
      {busy !== null && (
        <progress value={busy} max={1} data-testid="aiupscale-progress" aria-label={t('aiupscale.title')} />
      )}
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={cancel}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="aiupscale-apply"
          disabled={busy !== null || tooBig}
          onClick={() => void apply()}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
