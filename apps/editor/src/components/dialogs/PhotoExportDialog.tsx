import { useState } from 'react';
import { useT } from '../../i18n';
import {
  DEFAULT_PHOTO_EXPORT,
  exportIds,
  exportPhotos,
  type PhotoExportOptions,
} from '../../photoLibrary/exportPhotos';
import { pastedDevelopSettings } from '../../photo/rawDevelop';
import { Select } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

const SIZES = ['0', '4096', '2048', '1600', '1080', '640'];

/** Export de photos de la photothèque : format, taille, qualité, filigrane. */
export function PhotoExportDialog() {
  const t = useT();
  const ids = exportIds();
  const [o, setO] = useState<PhotoExportOptions>(DEFAULT_PHOTO_EXPORT);
  const [busy, setBusy] = useState(false);
  const canPaste = pastedDevelopSettings() !== null;
  const go = async () => {
    setBusy(true);
    const n = await exportPhotos(ids, o);
    setBusy(false);
    if (n !== null) close();
  };
  return (
    <Modal title={t('plib.exportTitle')} onClose={close}>
      <p className="note">{t('plib.exportHint', { n: ids.length })}</p>
      <Select
        label={t('export.format')}
        value={o.format}
        width={140}
        testId="pexp-format"
        options={[
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG' },
        ]}
        onChange={(v) => setO({ ...o, format: v === 'png' ? 'png' : 'jpeg' })}
      />
      <Select
        label={t('plib.exportSize')}
        value={String(o.maxSide)}
        width={200}
        testId="pexp-size"
        options={SIZES.map((s) => ({
          value: s,
          label: s === '0' ? t('plib.exportOriginal') : t('plib.exportLongSide', { px: s }),
        }))}
        onChange={(v) => setO({ ...o, maxSide: Number(v) })}
      />
      {o.format === 'jpeg' && (
        <label className="field">
          <span className="field-label">{t('export.quality')}</span>
          <input
            type="range"
            min={50}
            max={100}
            value={Math.round(o.quality * 100)}
            aria-label={t('export.quality')}
            onChange={(e) => setO({ ...o, quality: Number(e.target.value) / 100 })}
          />
          <span>{Math.round(o.quality * 100)}</span>
        </label>
      )}
      <label className="field">
        <span className="field-label">{t('plib.exportWatermark')}</span>
        <input
          className="text-input"
          value={o.watermark}
          placeholder={t('plib.exportWatermarkHint')}
          data-testid="pexp-watermark"
          onChange={(e) => setO({ ...o, watermark: e.target.value })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={o.useCopied && canPaste}
          disabled={!canPaste}
          data-testid="pexp-copied"
          onChange={(e) => setO({ ...o, useCopied: e.target.checked })}
        />
        {t('plib.exportCopied')}
      </label>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void go()} data-testid="pexp-go">
          {t('plib.exportGo')}
        </button>
      </footer>
    </Modal>
  );
}
