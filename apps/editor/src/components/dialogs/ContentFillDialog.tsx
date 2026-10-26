import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { closeContentFill, previewContentFill } from '../../photo/contentFill';
import { Slider } from '../PhotoContext';
import { Modal } from './Modal';

/** Remplir d'après le contenu : aperçu dans le document, zone d'échantillonnage, variantes. */
export function ContentFillDialog() {
  const t = useT();
  const [sampling, setSampling] = useState(90);
  const [seed, setSeed] = useState(1);
  const [newLayer, setNewLayer] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const id = setTimeout(
      () => void previewContentFill({ sampling: sampling / 100, seed }).then((ok) => ok && setReady(true)),
      250,
    );
    return () => clearTimeout(id);
  }, [sampling, seed]);
  return (
    <Modal title={t('edit.contentAwareFill')} onClose={() => closeContentFill(false)}>
      <p className="note">{t('contentfill.hint')}</p>
      <Slider
        label={t('contentfill.sampling')}
        value={sampling}
        min={30}
        max={300}
        unit="%"
        testId="contentfill-sampling"
        onChange={setSampling}
      />
      <button className="btn small" data-testid="contentfill-variant" onClick={() => setSeed((n) => n + 1)}>
        {t('contentfill.variant')}
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={newLayer}
          data-testid="contentfill-newlayer"
          onChange={(e) => setNewLayer(e.target.checked)}
        />
        {t('contentfill.newLayer')}
      </label>
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={() => closeContentFill(false)}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="contentfill-apply"
          disabled={!ready}
          onClick={() => closeContentFill(true, newLayer)}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
