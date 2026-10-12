import { useState } from 'react';
import { documentDpi, mmToPx, pxToMm } from '@poulpe/core';
import { useT } from '../../i18n';
import { updateLayout } from '../../layoutActions';
import { useEditor } from '../../store';
import { NumberField, Select } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/**
 * Réglages du document (comme « Configuration du document » d'Affinity Publisher) : résolution,
 * pages en vis-à-vis, numérotation, marges et fond perdu. Les longueurs se règlent en millimètres.
 */
export function DocumentDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const layout = doc.layout ?? {};
  const [dpi, setDpi] = useState(documentDpi(doc));
  const asDoc = { layout: { dpi } };
  const toMm = (px: number) => Math.round(pxToMm(asDoc, px) * 10) / 10;
  const [facing, setFacing] = useState(!!layout.facing);
  const [first, setFirst] = useState(layout.firstNumber ?? 1);
  const [showMargins, setShowMargins] = useState(!!layout.margins);
  const m = layout.margins;
  const defaultMargin = Math.round(pxToMm(doc, (doc.artboards[0]?.width ?? 1000) * 0.06));
  const [margins, setMargins] = useState({
    top: m ? toMm(m.top) : defaultMargin,
    bottom: m ? toMm(m.bottom) : defaultMargin,
    inside: m ? toMm(m.inside) : defaultMargin,
    outside: m ? toMm(m.outside) : defaultMargin,
  });
  const [bleed, setBleed] = useState(layout.bleed ? toMm(layout.bleed) : 0);
  const [colorMode, setColorMode] = useState<'rgb' | 'cmyk'>(layout.colorMode ?? 'rgb');
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const px = (v: number) => Math.round(mmToPx(asDoc, v) * 100) / 100;
  const field = (key: keyof typeof margins, label: string) => (
    <NumberField
      label={label}
      value={margins[key]}
      min={0}
      max={1000}
      decimals={1}
      unit="mm"
      width={110}
      disabled={!showMargins}
      testId={`margin-${key}`}
      onChange={(v) => setMargins({ ...margins, [key]: v })}
    />
  );
  return (
    <Modal title={t('docsetup.title')} onClose={close} wide>
      <div className="picker-row">
        <Select
          label={t('docsetup.dpi')}
          value={[72, 96, 150, 300, 600].includes(dpi) ? dpi : 0}
          options={[
            ...[72, 96, 150, 300, 600].map((v) => ({ value: v, label: `${v} ${t('docsetup.ppi')}` })),
            ...([72, 96, 150, 300, 600].includes(dpi)
              ? []
              : [{ value: 0, label: `${dpi} ${t('docsetup.ppi')}` }]),
          ]}
          onChange={(v) => v && setDpi(v)}
          width={140}
        />
        {ab && (
          <p className="note small grow">
            {t('docsetup.size', { w: toMm(ab.width), h: toMm(ab.height), pw: ab.width, ph: ab.height })}
          </p>
        )}
      </div>
      <p className="note small">{t('docsetup.dpiHint')}</p>
      <h4 className="sub">{t('docsetup.pages')}</h4>
      <div className="picker-row">
        <label className="check">
          <input
            type="checkbox"
            data-testid="doc-facing"
            checked={facing}
            onChange={(e) => setFacing(e.target.checked)}
          />
          {t('docsetup.facing')}
        </label>
        <NumberField
          label={t('docsetup.firstNumber')}
          value={first}
          min={1}
          max={9999}
          width={110}
          onChange={setFirst}
        />
      </div>
      <h4 className="sub">{t('docsetup.margins')}</h4>
      <label className="check">
        <input
          type="checkbox"
          data-testid="doc-margins"
          checked={showMargins}
          onChange={(e) => setShowMargins(e.target.checked)}
        />
        {t('docsetup.showMargins')}
      </label>
      <div className="picker-row">
        {field('top', t('docsetup.top'))}
        {field('bottom', t('docsetup.bottom'))}
        {field('inside', facing ? t('docsetup.inside') : t('docsetup.left'))}
        {field('outside', facing ? t('docsetup.outside') : t('docsetup.right'))}
      </div>
      <h4 className="sub">{t('docsetup.bleed')}</h4>
      <div className="picker-row">
        <NumberField
          label={t('docsetup.bleedAll')}
          value={bleed}
          min={0}
          max={100}
          decimals={1}
          unit="mm"
          width={110}
          testId="doc-bleed"
          onChange={setBleed}
        />
        <p className="note small grow">{t('docsetup.bleedHint')}</p>
      </div>
      <h4 className="sub">{t('docsetup.colors')}</h4>
      <div className="picker-row">
        <Select
          label={t('docsetup.colorMode')}
          value={colorMode}
          options={[
            { value: 'rgb', label: t('docsetup.rgb') },
            { value: 'cmyk', label: t('docsetup.cmyk') },
          ]}
          onChange={(v) => setColorMode(v as 'rgb' | 'cmyk')}
          width={200}
          testId="doc-color"
        />
        <p className="note small grow">{t('docsetup.colorHint')}</p>
      </div>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="doc-apply"
          onClick={() => {
            updateLayout({
              dpi,
              facing: facing || undefined,
              firstNumber: first !== 1 ? first : undefined,
              colorMode: colorMode === 'cmyk' ? 'cmyk' : undefined,
              bleed: bleed > 0 ? px(bleed) : undefined,
              margins: showMargins
                ? {
                    top: px(margins.top),
                    bottom: px(margins.bottom),
                    inside: px(margins.inside),
                    outside: px(margins.outside),
                  }
                : undefined,
            });
            close();
          }}
        >
          {t('docsetup.apply')}
        </button>
      </footer>
    </Modal>
  );
}
