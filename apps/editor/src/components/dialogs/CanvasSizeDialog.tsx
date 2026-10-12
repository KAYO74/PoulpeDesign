import { useState } from 'react';
import { useT } from '../../i18n';
import { setCanvasSize } from '../../photo/retouchActions';
import { useEditor } from '../../store';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Taille de la zone de travail : le plan de travail change de taille autour d'un point d'ancrage. */
export function CanvasSizeDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const [size, setSize] = useState({
    width: Math.round(ab?.width ?? 1),
    height: Math.round(ab?.height ?? 1),
  });
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  if (!ab) return null;
  return (
    <Modal title={t('document.canvasSize').replace('…', '')} onClose={close}>
      <p className="note">{t('size.current', { w: Math.round(ab.width), h: Math.round(ab.height) })}</p>
      <div className="picker-row">
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) => setSize({ ...size, width: v })}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={30000}
          unit="px"
          width={130}
          onChange={(v) => setSize({ ...size, height: v })}
        />
        <span className="field">
          <span className="field-label">{t('size.anchor')}</span>
          <span className="anchor-grid" role="group" aria-label={t('size.anchor')}>
            {[0, 0.5, 1].map((y) =>
              [0, 0.5, 1].map((x) => (
                <button
                  key={`${x}-${y}`}
                  className="anchor-cell"
                  aria-pressed={anchor[0] === x && anchor[1] === y}
                  aria-label={`${x} ${y}`}
                  onClick={() => setAnchor([x, y])}
                />
              )),
            )}
          </span>
        </span>
      </div>
      <p className="note small">{t('size.canvasHint')}</p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="canvas-size-ok"
          onClick={() => {
            close();
            setCanvasSize(size.width, size.height, anchor[0], anchor[1]);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}
