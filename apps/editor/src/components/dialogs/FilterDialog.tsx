import { useEffect, useState } from 'react';
import { defaultAdjustment, type Adjustment } from '@poulpe/core';
import { useT } from '../../i18n';
import { AdjustmentFields } from '../../panels/AdjustmentPanel';
import { applyFilter, previewFilter } from '../../photo/photoActions';
import { useUi } from '../../store';
import { Modal } from './Modal';
import { close } from './close';

/** Filtre appliqué aux pixels du calque choisi, avec aperçu en direct. */
export function FilterDialog() {
  const t = useT();
  const kind = useUi((s) => s.filterKind);
  const [adj, setAdj] = useState<Adjustment>(() => defaultAdjustment(kind ?? 'gaussianBlur'));
  const [preview, setPreview] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => previewFilter(preview ? adj : null), 120);
    return () => clearTimeout(id);
  }, [adj, preview]);
  useEffect(() => () => previewFilter(null), []);
  if (!kind) return null;
  const cancel = () => {
    previewFilter(null);
    close();
  };
  return (
    <Modal title={t(`adjust.${kind}`)} onClose={cancel}>
      <p className="note">{t('filter.hint')}</p>
      <AdjustmentFields adj={adj} onChange={setAdj} />
      <footer>
        <label className="check">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
          {t('filter.preview')}
        </label>
        <span className="spacer" />
        <button className="btn" onClick={cancel}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="filter-apply"
          onClick={() => {
            close();
            void applyFilter(adj);
          }}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
