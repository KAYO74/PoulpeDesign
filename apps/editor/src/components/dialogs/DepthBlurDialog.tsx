import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import {
  applyDepthBlur,
  closeDepthBlur,
  depthAtPreview,
  depthPreview,
  estimateDepth,
  toastDepthFailed,
} from '../../photo/depthBlur';
import { Slider } from '../PhotoContext';
import { Modal } from './Modal';

/** Flou d'objectif : aperçu cliquable (plan net), zone nette, force, carte de profondeur. */
export function DepthBlurDialog() {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState(0.5);
  const [range, setRange] = useState(10);
  const [amount, setAmount] = useState(50);
  const [showDepth, setShowDepth] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    estimateDepth()
      .then((ok) => {
        if (closed.current) return;
        if (ok) setReady(true);
        else {
          toastDepthFailed(false);
          closeDepthBlur();
        }
      })
      .catch((e) => {
        console.error(e);
        if (closed.current) return;
        toastDepthFailed(e instanceof Error && e.message === 'model-missing');
        closeDepthBlur();
      });
    return () => {
      closed.current = true;
    };
  }, []);

  // Aperçu : recalculé (un peu après le dernier réglage) quand un réglage change.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      const img = depthPreview({ focus, range: range / 100, amount }, showDepth);
      const c = canvas.current;
      if (!img || !c) return;
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
    }, 60);
    return () => clearTimeout(id);
  }, [ready, focus, range, amount, showDepth]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = depthAtPreview((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (d !== null) setFocus(d);
  };
  const apply = () => {
    if (!applyDepthBlur({ focus, range: range / 100, amount })) toastDepthFailed(false);
    closeDepthBlur();
  };
  return (
    <Modal title={t('depthblur.title')} onClose={closeDepthBlur}>
      <p className="note">{t('depthblur.hint')}</p>
      {!ready && (
        <progress data-testid="depthblur-loading" aria-label={t('depthblur.loading')}>
          {t('depthblur.loading')}
        </progress>
      )}
      <canvas
        ref={canvas}
        data-testid="depthblur-preview"
        aria-label={t('depthblur.preview')}
        style={{
          width: '100%',
          maxHeight: 320,
          objectFit: 'contain',
          cursor: 'crosshair',
          display: ready ? 'block' : 'none',
        }}
        onClick={pick}
      />
      <Slider
        label={t('depthblur.range')}
        value={range}
        min={0}
        max={50}
        unit="%"
        testId="depthblur-range"
        onChange={setRange}
      />
      <Slider
        label={t('depthblur.amount')}
        value={amount}
        min={0}
        max={100}
        unit="%"
        testId="depthblur-amount"
        onChange={setAmount}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={showDepth}
          data-testid="depthblur-showdepth"
          onChange={(e) => setShowDepth(e.target.checked)}
        />
        {t('depthblur.showDepth')}
      </label>
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={closeDepthBlur}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="depthblur-apply" disabled={!ready} onClick={apply}>
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
