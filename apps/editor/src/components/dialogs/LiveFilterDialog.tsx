import { useEffect, useState } from 'react';
import type { Adjustment } from '@poulpe/core';
import { useT } from '../../i18n';
import { AdjustmentFields } from '../../panels/AdjustmentPanel';
import { closeLiveFilter, openLiveFilter, previewLiveFilter } from '../../photo/liveFilters';
import { Modal } from './Modal';

/** Réglage d'un filtre en direct : l'aperçu s'affiche dans le document pendant qu'on règle. */
export function LiveFilterDialog() {
  const t = useT();
  const [adj, setAdj] = useState<Adjustment | null>(openLiveFilter);
  useEffect(() => {
    if (!adj) return;
    const id = setTimeout(() => previewLiveFilter(adj), 60);
    return () => clearTimeout(id);
  }, [adj]);
  if (!adj) return null;
  return (
    <Modal
      title={`${t(`adjust.${adj.kind}`)} · ${t('livefilter.title')}`}
      onClose={() => closeLiveFilter(false)}
    >
      <p className="note">{t('livefilter.hint')}</p>
      <AdjustmentFields adj={adj} onChange={setAdj} />
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={() => closeLiveFilter(false)}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="livefilter-apply"
          onClick={() => {
            previewLiveFilter(adj);
            closeLiveFilter(true);
          }}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
