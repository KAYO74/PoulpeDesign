import { useState } from 'react';
import { FORMAT_PRESETS } from '@poulpe/core';
import { useT } from '../../i18n';
import { resizeDesign } from '../../libraryActions';
import { useEditor } from '../../store';
import { NumberField } from '../fields';
import { Icon } from '../Icon';
import { Modal } from './Modal';
import { close } from './close';

export function ResizeDialog() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const ab = doc.artboards.find((a) => a.id === activeArtboardId) ?? doc.artboards[0];
  const [size, setSize] = useState({ width: 1080, height: 1920 });
  const [preset, setPreset] = useState<string>('story');
  const [copy, setCopy] = useState(true);
  if (!ab) return null;
  return (
    <Modal title={t('resize.title')} onClose={close} wide>
      <p className="note">{t('resize.current', { w: Math.round(ab.width), h: Math.round(ab.height) })}</p>
      {(['social', 'print', 'screen'] as const).map((c) => (
        <div key={c}>
          <h4 className="sub">{t(`library.cat.${c}`)}</h4>
          <div className="preset-grid compact">
            {FORMAT_PRESETS.filter((f) => f.category === c).map((f) => (
              <button
                key={f.id}
                className={`preset${preset === f.id ? ' on' : ''}`}
                data-testid={`resize-${f.id}`}
                onClick={() => {
                  setPreset(f.id);
                  setSize({ width: f.width, height: f.height });
                }}
              >
                <span className="preset-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                <b>{t(`format.${f.id}`)}</b>
                <span className="num">
                  {f.width} × {f.height}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="picker-row">
        <NumberField
          label={t('new.width')}
          value={size.width}
          min={1}
          max={20000}
          unit="px"
          width={130}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, width: v }))}
        />
        <NumberField
          label={t('new.height')}
          value={size.height}
          min={1}
          max={20000}
          unit="px"
          width={130}
          onChange={(v) => (setPreset('custom'), setSize({ ...size, height: v }))}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        {t('resize.copy')}
      </label>
      <p className="note small">{t('resize.hint')}</p>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="resize-go"
          onClick={() =>
            resizeDesign(
              size.width,
              size.height,
              copy,
              preset !== 'custom' ? `${ab.name} · ${t(`format.${preset}`)}` : undefined,
            )
          }
        >
          <Icon name="resize" />
          {t('resize.go')}
        </button>
      </footer>
    </Modal>
  );
}
