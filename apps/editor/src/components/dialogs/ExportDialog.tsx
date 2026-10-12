import { useState } from 'react';
import { documentDpi, printablePages, pxToMm } from '@poulpe/core';
import { useT } from '../../i18n';
import { exportDocument, type ExportOptions } from '../../io';
import { ui, useEditor } from '../../store';
import { NumberField, Select } from '../fields';
import { Icon } from '../Icon';
import { Modal } from './Modal';
import { close } from './close';

export function ExportDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const pages = printablePages(doc);
  const bleed = doc.layout?.bleed ?? 0;
  const [opts, setOpts] = useState<ExportOptions>({
    kind: 'png',
    artboardId: activeArtboardId,
    scale: 1,
    quality: 0.92,
    transparent: false,
    pages: '',
    bleed: bleed > 0,
    marks: false,
    color: doc.layout?.colorMode === 'cmyk' ? 'cmyk' : 'rgb',
    pdfx: false,
  });
  const [busy, setBusy] = useState(false);
  const raster = opts.kind === 'png' || opts.kind === 'jpeg';
  const pdf = opts.kind === 'pdf';
  const mm = (px: number) => Math.round(pxToMm(doc, px) * 10) / 10;
  const ref = doc.artboards.find((a) => a.id === activeArtboardId) ?? pages[0];
  return (
    <Modal title={t('export.title')} onClose={close}>
      <div className="seg full" role="group" aria-label={t('export.format')}>
        {(['png', 'jpeg', 'svg', 'pdf', 'psd'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={opts.kind === k}
            data-testid={`export-${k}`}
            onClick={() =>
              setOpts({
                ...opts,
                kind: k,
                // Le PDF est un document de plusieurs pages : toutes les pages par défaut.
                artboardId: k === 'pdf' && pages.length > 1 ? 'all' : opts.artboardId,
              })
            }
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <Select
        label={t('export.artboard')}
        value={opts.artboardId}
        options={[
          ...doc.artboards.map((a) => ({
            value: a.id,
            label: `${a.name} · ${a.width} × ${a.height}${a.master ? ` (${t('pages.masterTag')})` : ''}`,
          })),
          ...(pages.length > 1 ? [{ value: 'all', label: t('export.allArtboards') }] : []),
          ...(pdf && pages.length > 1 ? [{ value: 'range', label: t('export.range') }] : []),
        ]}
        onChange={(v) => setOpts({ ...opts, artboardId: v })}
      />
      {pdf && opts.artboardId === 'range' && (
        <label className="field">
          <span className="field-label">{t('export.rangeLabel')}</span>
          <input
            className="text-input"
            data-testid="export-range"
            placeholder="1-3, 5"
            value={opts.pages}
            onChange={(e) => setOpts({ ...opts, pages: e.target.value })}
          />
        </label>
      )}
      {pdf && (
        <>
          <p className="note small">
            {t('export.printSize', {
              w: mm(ref.width),
              h: mm(ref.height),
              dpi: documentDpi(doc),
            })}
          </p>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-bleed"
              checked={opts.bleed}
              disabled={!bleed}
              onChange={(e) => setOpts({ ...opts, bleed: e.target.checked })}
            />
            {bleed ? t('export.bleed', { mm: mm(bleed) }) : t('export.noBleed')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-marks"
              checked={opts.marks}
              onChange={(e) => setOpts({ ...opts, marks: e.target.checked })}
            />
            {t('export.marks')}
          </label>
          <div className="picker-row">
            <Select
              label={t('export.colors')}
              value={opts.pdfx ? 'cmyk' : (opts.color ?? 'rgb')}
              options={[
                { value: 'rgb', label: t('docsetup.rgb') },
                { value: 'cmyk', label: t('docsetup.cmyk') },
              ]}
              onChange={(v) =>
                setOpts({ ...opts, color: v as 'rgb' | 'cmyk', pdfx: v === 'rgb' ? false : opts.pdfx })
              }
              width={200}
              testId="export-color"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              data-testid="export-pdfx"
              checked={!!opts.pdfx}
              onChange={(e) =>
                setOpts({ ...opts, pdfx: e.target.checked, color: e.target.checked ? 'cmyk' : opts.color })
              }
            />
            {t('export.pdfx')}
          </label>
          {(opts.pdfx || opts.color === 'cmyk') && <p className="note small">{t('export.cmykHint')}</p>}
        </>
      )}
      {opts.kind === 'psd' && <p className="note small">{t('export.psdHint')}</p>}
      {raster && (
        <div className="picker-row">
          <Select
            label={t('export.scale')}
            value={opts.scale}
            options={[0.5, 1, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))}
            onChange={(v) => setOpts({ ...opts, scale: v })}
            width={110}
          />
          {opts.kind === 'jpeg' && (
            <NumberField
              label={t('export.quality')}
              value={Math.round(opts.quality * 100)}
              min={10}
              max={100}
              unit="%"
              width={110}
              onChange={(v) => setOpts({ ...opts, quality: v / 100 })}
            />
          )}
        </div>
      )}
      {(opts.kind === 'png' || opts.kind === 'svg') && (
        <label className="check">
          <input
            type="checkbox"
            checked={opts.transparent}
            onChange={(e) => setOpts({ ...opts, transparent: e.target.checked })}
          />
          {t('export.transparent')}
        </label>
      )}
      {opts.kind === 'pdf' && <p className="note">{t('export.pdfFonts')}</p>}
      <footer>
        <button className="btn" data-testid="export-batch" onClick={() => ui.set({ dialog: 'batch' })}>
          {t('export.batch')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="export-go"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportDocument(opts);
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
