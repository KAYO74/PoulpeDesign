import { useState } from 'react';
import { useT } from '../../i18n';
import { newPixelLayer } from '../../photo/pixels';
import { editor } from '../../store';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Crée plusieurs calques de pixels vides d'un coup. */
export function LayerCountDialog() {
  const t = useT();
  // Chaque calque vide pèse largeur × hauteur × 4 octets : on limite le total à environ 1,5 Go.
  const ab = editor.doc.artboards[0];
  const k = ab ? Math.min(1, 8192 / Math.max(ab.width, ab.height)) : 1;
  const bytes = ab ? Math.max(1, ab.width * k * ab.height * k * 4) : 1;
  const maxN = Math.max(1, Math.min(50, Math.floor(1.5e9 / bytes)));
  const [n, setN] = useState(Math.min(5, maxN));
  const go = () => {
    close();
    for (let i = 0; i < n; i++) newPixelLayer();
  };
  return (
    <Modal title={t('layer.manyTitle')} onClose={close}>
      <NumberField
        label={t('layer.manyCount')}
        value={n}
        min={1}
        max={maxN}
        width={80}
        testId="layers-count"
        onChange={(v) => setN(Math.max(1, Math.min(maxN, Math.round(v))))}
      />
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" onClick={go} data-testid="layers-go">
          {t('layer.manyGo')}
        </button>
      </footer>
    </Modal>
  );
}
