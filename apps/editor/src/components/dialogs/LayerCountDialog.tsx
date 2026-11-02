import { useState } from 'react';
import { useT } from '../../i18n';
import { newPixelLayer } from '../../photo/pixels';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Crée plusieurs calques de pixels vides d'un coup. */
export function LayerCountDialog() {
  const t = useT();
  const [n, setN] = useState(5);
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
        max={50}
        width={80}
        testId="layers-count"
        onChange={(v) => setN(Math.max(1, Math.min(50, Math.round(v))))}
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
