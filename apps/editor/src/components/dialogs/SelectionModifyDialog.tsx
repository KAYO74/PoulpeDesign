import { useState } from 'react';
import { useT } from '../../i18n';
import { modifySelection } from '../../photo/selection';
import { useUi } from '../../store';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Adoucir, agrandir ou réduire la sélection de pixels. */
export function SelectionModifyDialog() {
  const t = useT();
  const kind = useUi((s) => s.selectionModify) ?? 'feather';
  const [radius, setRadius] = useState(kind === 'feather' ? 10 : 5);
  return (
    <Modal title={t(`selmod.${kind}`)} onClose={close}>
      <div className="picker-row">
        <NumberField
          label={t('selmod.radius')}
          value={radius}
          min={0}
          max={500}
          decimals={1}
          unit="px"
          width={130}
          onChange={setRadius}
        />
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            close();
            modifySelection(kind, radius);
          }}
        >
          OK
        </button>
      </footer>
    </Modal>
  );
}
