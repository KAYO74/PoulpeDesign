import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { cancelFusion, DEFAULT_FUSION, fuseSelected, type FusionSettings } from '../../smart/fusion';
import { NumberField, Select } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/*
 * Fusion d'expositions (rendu HDR) et empilement de mise au point : les images choisies donnent
 * une nouvelle image, les originaux restent en place.
 */

export function FusionDialog() {
  const t = useT();
  const [s, setS] = useState<FusionSettings>(DEFAULT_FUSION);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState('');
  // Fenêtre fermée pendant le calcul : on l'arrête.
  useEffect(() => cancelFusion, []);

  const run = async () => {
    setBusy(true);
    setDone(0);
    setStatus('');
    try {
      const ok = await fuseSelected(s, setDone);
      if (ok) close();
      else setStatus(t('fusion.cancelled'));
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };
  const num = (key: 'contrast' | 'saturation' | 'exposure', label: string) => (
    <NumberField
      label={label}
      value={s[key]}
      min={0}
      max={2}
      step={0.1}
      decimals={1}
      width={80}
      testId={`fusion-${key}`}
      disabled={busy}
      onChange={(v) => setS((p) => ({ ...p, [key]: v }))}
    />
  );

  return (
    <Modal title={t('fusion.title')} onClose={close}>
      <p className="hint">{t(s.mode === 'focus' ? 'fusion.hintFocus' : 'fusion.hintExposure')}</p>
      <div className="picker-row">
        <Select
          label={t('fusion.mode')}
          value={s.mode}
          testId="fusion-mode"
          disabled={busy}
          options={[
            { value: 'exposure', label: t('fusion.mode.exposure') },
            { value: 'focus', label: t('fusion.mode.focus') },
          ]}
          onChange={(mode) => setS((p) => ({ ...p, mode }))}
        />
      </div>
      {s.mode === 'exposure' && (
        <div className="picker-row">
          {num('contrast', t('fusion.contrast'))}
          {num('saturation', t('fusion.saturation'))}
          {num('exposure', t('fusion.wellExposed'))}
        </div>
      )}
      {busy && (
        <div className="picker-row">
          <progress max={1} value={done} data-testid="fusion-progress" aria-label={t('fusion.working')} />
          <button className="btn small" data-testid="fusion-cancel" onClick={cancelFusion}>
            {t('new.cancel')}
          </button>
        </div>
      )}
      {status && (
        <p className="note" data-testid="fusion-status">
          {status}
        </p>
      )}
      <footer>
        <button className="btn" onClick={close}>
          {t('common.close')}
        </button>
        <button className="btn primary" data-testid="fusion-run" disabled={busy} onClick={() => void run()}>
          {t('fusion.run')}
        </button>
      </footer>
    </Modal>
  );
}
