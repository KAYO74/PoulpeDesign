import { useState } from 'react';
import { useT } from '../../i18n';
import { offsetPath } from '../../vectorActions';
import { NumberField, Select } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Décalage du tracé : une copie du contour, agrandie ou rétrécie d'une distance donnée. */
export function OffsetDialog() {
  const t = useT();
  const [distance, setDistance] = useState(10);
  const [join, setJoin] = useState<'round' | 'miter' | 'bevel'>('round');
  return (
    <Modal title={t('offset.title')} onClose={close}>
      <p className="note">{t('offset.hint')}</p>
      <div className="picker-row">
        <NumberField
          label={t('offset.distance')}
          value={distance}
          min={-1000}
          max={1000}
          decimals={1}
          unit="px"
          width={130}
          testId="offset-distance"
          onChange={setDistance}
        />
        <Select
          label={t('stroke.join')}
          value={join}
          options={(['round', 'miter', 'bevel'] as const).map((j) => ({
            value: j,
            label: t(`stroke.join.${j}`),
          }))}
          onChange={setJoin}
        />
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="offset-go"
          onClick={() => {
            close();
            offsetPath(distance, join);
          }}
        >
          {t('offset.go')}
        </button>
      </footer>
    </Modal>
  );
}
