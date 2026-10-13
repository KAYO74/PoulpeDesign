import { useState } from 'react';
import { useT } from '../../i18n';
import { setImageSize } from '../../photo/retouchActions';
import { useEditor } from '../../store';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Taille de l'image : tout le contenu du plan de travail est mis à l'échelle. */
export function ImageSizeDialog() {
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
