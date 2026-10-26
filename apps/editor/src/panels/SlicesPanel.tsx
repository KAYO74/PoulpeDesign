import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import {
  exportSlices,
  presetLabel,
  removeSlice,
  SLICE_PRESETS,
  sliceFileCount,
  slicesFromArtboards,
  slicesFromSelection,
  toggleSliceExport,
  updateSlice,
} from '../slices';
import { editor, useEditor } from '../store';

/** Panneau Tranches de la Persona Export : chaque tranche, ses formats, et l'export de tout. */
export function SlicesPanel() {
  const t = useT();
  const { doc, selection } = useEditor();
  const slices = doc.slices ?? [];
  const count = sliceFileCount(doc);
  return (
    <aside className="library slices-panel" aria-label={t('slices.title')} data-testid="slices-panel">
      <header className="studio-tabs" role="tablist">
        <span className="studio-tab" role="tab" aria-selected="true">
          {t('slices.title')}
        </span>
      </header>
      <div className="studio-content slices-scroll">
        <div className="slices-actions">
          <button
            className="btn small"
            disabled={!selection.length}
            onClick={slicesFromSelection}
            data-testid="slices-from-selection"
          >
            {t('slices.fromSelection')}
          </button>
          <button className="btn small" onClick={slicesFromArtboards} data-testid="slices-from-artboards">
            {t('slices.fromArtboards')}
          </button>
        </div>
        {!slices.length && <p className="note">{t('slices.empty')}</p>}
        <ul className="slices-list">
          {slices.map((s) => (
            <li key={s.id} className="slice" data-testid={`slice-${s.id}`}>
              <div className="slice-head">
                <Icon name={s.layerId ? 'pixelLayer' : 'artboard'} size={14} />
                <input
                  className="slice-name"
                  defaultValue={s.name}
                  aria-label={t('slices.name')}
                  onFocus={() => s.layerId && editor.select([s.layerId])}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== s.name) updateSlice(s.id, (x) => void (x.name = name));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <button
                  className="layer-btn"
                  title={t('slices.remove')}
                  aria-label={t('slices.remove')}
                  onClick={() => removeSlice(s.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="slice-formats" role="group" aria-label={t('slices.formats')}>
                {SLICE_PRESETS.map((p) => {
                  const on = s.exports.some((e) => e.format === p.format && e.scale === p.scale);
                  return (
                    <button
                      key={presetLabel(p)}
                      className={`chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleSliceExport(s.id, p)}
                    >
                      {presetLabel(p)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <button
          className="btn primary"
          disabled={!count}
          onClick={() => void exportSlices()}
          data-testid="slices-export"
        >
          {t('slices.export', { n: count })}
        </button>
      </div>
    </aside>
  );
}
