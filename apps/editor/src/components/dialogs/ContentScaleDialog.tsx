import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import {
  applyContentScale,
  closeContentScale,
  hasSelectionToProtect,
  toastScaleFailed,
} from '../../photo/contentScale';
import { Slider } from '../PhotoContext';
import { Modal } from './Modal';

/** Mise à l'échelle selon le contenu : largeur, hauteur, quantité, protection de la sélection. */
export function ContentScaleDialog() {
  const t = useT();
  const [w, setW] = useState(100);
  const [h, setH] = useState(100);
  const [amount, setAmount] = useState(100);
  const [protect, setProtect] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const stop = useRef(false);
  const canProtect = hasSelectionToProtect();
  const cancel = () => {
    stop.current = true;
    closeContentScale();
  };
  const apply = async () => {
    stop.current = false;
    setBusy(0);
    try {
      const ok = await applyContentScale(
        { widthPct: w, heightPct: h, amount: amount / 100, protect: protect && canProtect },
        setBusy,
        () => stop.current,
      );
      if (!ok && !stop.current) toastScaleFailed();
    } catch {
      toastScaleFailed();
    }
    if (!stop.current) closeContentScale();
  };
  return (
    <Modal title={t('contentscale.title')} onClose={cancel}>
      <p className="note">{t('contentscale.hint')}</p>
      <Slider
        label={t('contentscale.width')}
        value={w}
        min={50}
        max={150}
        unit="%"
        testId="contentscale-width"
        onChange={setW}
      />
      <Slider
        label={t('contentscale.height')}
        value={h}
        min={50}
        max={150}
        unit="%"
        testId="contentscale-height"
        onChange={setH}
      />
      <Slider
        label={t('contentscale.amount')}
        value={amount}
        min={0}
        max={100}
        unit="%"
        testId="contentscale-amount"
        onChange={setAmount}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={protect && canProtect}
          disabled={!canProtect}
          data-testid="contentscale-protect"
          onChange={(e) => setProtect(e.target.checked)}
        />
        {t('contentscale.protect')}
      </label>
      {busy !== null && (
        <progress
          value={busy}
          max={1}
          data-testid="contentscale-progress"
          aria-label={t('contentscale.title')}
        />
      )}
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={cancel}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="contentscale-apply"
          disabled={busy !== null}
          onClick={() => void apply()}
        >
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
