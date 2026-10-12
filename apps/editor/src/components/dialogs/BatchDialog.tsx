import { useState } from 'react';
import { useT } from '../../i18n';
import { batchExport, type BatchExportOptions, type ExportKind } from '../../io';
import { ui, useEditor } from '../../store';
import { Icon } from '../Icon';
import { Modal } from './Modal';
import { close } from './close';

/** Export par lots : plusieurs plans de travail, plusieurs formats et tailles, dans un fichier ZIP. */
export function BatchDialog() {
  const t = useT();
  const { doc } = useEditor();
  const [opts, setOpts] = useState<BatchExportOptions>({
    artboardIds: doc.artboards.filter((a) => !a.master).map((a) => a.id),
    formats: ['png'],
    scales: [1, 2],
    quality: 0.92,
    transparent: false,
    cmyk: doc.layout?.colorMode === 'cmyk',
  });
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const raster = opts.formats.includes('png') || opts.formats.includes('jpeg');
  return (
    <Modal title={t('export.batchTitle')} onClose={close} wide>
      <p className="note">{t('export.batchHint')}</p>
      <h4 className="sub">{t('export.batchPages')}</h4>
      <div className="batch-list">
        {doc.artboards.map((a) => (
          <label key={a.id} className="check">
            <input
              type="checkbox"
              checked={opts.artboardIds.includes(a.id)}
              onChange={() => setOpts({ ...opts, artboardIds: toggle(opts.artboardIds, a.id) })}
            />
            {a.name}
            {a.master ? ` (${t('pages.masterTag')})` : ''}
          </label>
        ))}
      </div>
      <h4 className="sub">{t('export.format')}</h4>
      <div className="picker-row">
        {(['png', 'jpeg', 'svg', 'pdf', 'psd'] as ExportKind[]).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              data-testid={`batch-${k}`}
              checked={opts.formats.includes(k)}
              onChange={() => setOpts({ ...opts, formats: toggle(opts.formats, k) })}
            />
            {k.toUpperCase()}
          </label>
        ))}
      </div>
      {raster && (
        <>
          <h4 className="sub">{t('export.scale')}</h4>
          <div className="picker-row">
            {[0.5, 1, 2, 3, 4].map((sc) => (
              <label key={sc} className="check">
                <input
                  type="checkbox"
                  data-testid={`batch-scale-${sc}`}
                  checked={opts.scales.includes(sc)}
                  onChange={() => setOpts({ ...opts, scales: toggle(opts.scales, sc).sort((a, b) => a - b) })}
                />
                {sc}×
              </label>
            ))}
          </div>
        </>
      )}
      {opts.formats.includes('pdf') && (
        <label className="check">
          <input
            type="checkbox"
            checked={opts.cmyk}
            onChange={(e) => setOpts({ ...opts, cmyk: e.target.checked })}
          />
          {t('export.batchCmyk')}
        </label>
      )}
      <footer>
        <button className="btn" onClick={() => ui.set({ dialog: 'export' })}>
          {t('export.back')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="batch-go"
          disabled={busy || !opts.artboardIds.length || !opts.formats.length}
          onClick={async () => {
            setBusy(true);
            try {
              await batchExport(opts);
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="export" />
          {t('export.go')}
        </button>
      </footer>
    </Modal>
  );
}
