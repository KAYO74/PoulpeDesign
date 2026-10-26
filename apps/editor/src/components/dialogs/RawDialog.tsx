import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { P, ParamField } from '../../panels/AdjustmentPanel';
import {
  closeRaw,
  copyDevelopSettings,
  DEFAULT_DEVELOP,
  developRaw,
  pastedDevelopSettings,
  rawPhoto,
  type DevelopSettings,
} from '../../photo/rawDevelop';
import { Modal } from './Modal';

const PARAMS = [
  P('exposure', -5, 5, 'IL', 0.05),
  P('temperature', -100, 100),
  P('tint', -100, 100),
  P('contrast', -100, 100),
  P('highlights', -100, 100),
  P('shadows', -100, 100),
  P('vibrance', -100, 100),
  P('saturation', -100, 100),
];

/** Fenêtre de développement d'une photo RAW : aperçu réduit, réglages, puis Développer. */
export function RawDialog() {
  const t = useT();
  const photo = rawPhoto();
  const [s, setS] = useState<DevelopSettings>(DEFAULT_DEVELOP);
  const [canPaste, setCanPaste] = useState(() => pastedDevelopSettings() !== null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!photo) return;
    const id = requestAnimationFrame(() => {
      const img = photo.render(s, 900);
      const c = canvas.current;
      if (!c) return;
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [photo, s]);
  if (!photo) return null;
  return (
    <Modal title={t('raw.title')} onClose={closeRaw} xl>
      <div className="raw-develop">
        <canvas ref={canvas} className="raw-preview" data-testid="raw-preview" />
        <div className="raw-params">
          <p className="note">
            {photo.width} × {photo.height} px
          </p>
          {PARAMS.map((p) => (
            <ParamField
              key={p.key}
              p={p}
              value={s[p.key as keyof DevelopSettings]}
              onChange={(v) => setS((old) => ({ ...old, [p.key]: v }))}
            />
          ))}
          <button className="btn small" onClick={() => setS(DEFAULT_DEVELOP)}>
            {t('param.reset')}
          </button>
          <div className="raw-copy">
            <button
              className="btn small"
              title={t('raw.copyHint')}
              data-testid="raw-copy"
              onClick={() => {
                copyDevelopSettings(s);
                setCanPaste(true);
              }}
            >
              {t('raw.copy')}
            </button>
            <button
              className="btn small"
              disabled={!canPaste}
              title={t('raw.pasteHint')}
              data-testid="raw-paste"
              onClick={() => {
                const p = pastedDevelopSettings();
                if (p) setS(p);
              }}
            >
              {t('raw.paste')}
            </button>
          </div>
        </div>
      </div>
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={closeRaw}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="raw-develop" onClick={() => developRaw(s)}>
          {t('raw.develop')}
        </button>
      </footer>
    </Modal>
  );
}
