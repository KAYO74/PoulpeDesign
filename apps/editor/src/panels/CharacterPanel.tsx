import { CANVAS_FEATURES, OPENTYPE_FEATURES, findNode, type TextNode, type TextStyle } from '@poulpe/core';
import { setTextStyle, updateSelected } from '../actions';
import { FontPicker } from '../components/FontPicker';
import { NumberField, Select } from '../components/fields';
import { Icon, type IconName } from '../components/Icon';
import { WEIGHTS, useFonts } from '../fonts';
import { useT } from '../i18n';
import { editingStyle } from '../canvas/textEdit';
import { useEditor, useTextSelection, useUi } from '../store';

export function CharacterPanel() {
  const t = useT();
  const fonts = useFonts();
  const { doc, selection } = useEditor();
  const defaults = useUi((s) => s.defaults);
  useTextSelection();
  const text = selection.map((id) => findNode(doc, id)?.node).find((n): n is TextNode => n?.type === 'text');
  // Pendant l'édition, les réglages montrés sont ceux du début de la sélection.
  const st: TextStyle = editingStyle() ?? text?.style ?? defaults.text;
  const toggle = (key: 'italic' | 'underline' | 'strike' | 'uppercase', icon: IconName, label: string) => (
    <button
      className="ib"
      aria-pressed={st[key]}
      title={label}
      aria-label={label}
      onClick={() => setTextStyle({ [key]: !st[key] })}
    >
      <Icon name={icon} />
    </button>
  );
  const align = (value: TextStyle['align'], icon: IconName, label: string) => (
    <button
      className="ib"
      aria-pressed={st.align === value}
      title={label}
      aria-label={label}
      onClick={() => setTextStyle({ align: value })}
    >
      <Icon name={icon} />
    </button>
  );
  const families = fonts.includes(st.fontFamily) ? fonts : [st.fontFamily, ...fonts];
  return (
    <div className="panel-body">
      {!text && <p className="empty">{t('char.noText')}</p>}
      <FontPicker
        label={t('char.font')}
        value={st.fontFamily}
        fonts={families}
        onChange={(f) => setTextStyle({ fontFamily: f })}
      />
      <div className="picker-row">
        <Select
          label={t('char.weight')}
          value={st.fontWeight}
          options={WEIGHTS.map((w) => ({ value: w, label: String(w) }))}
          onChange={(w) => setTextStyle({ fontWeight: w })}
          width={110}
        />
        <NumberField
          label={t('char.size')}
          value={st.fontSize}
          min={1}
          max={2000}
          unit="px"
          decimals={1}
          width={100}
          onChange={(v) => setTextStyle({ fontSize: v })}
          testId="font-size"
        />
      </div>
      <div className="picker-row">
        <NumberField
          label={t('char.tracking')}
          value={st.letterSpacing}
          min={-100}
          max={500}
          unit="px"
          decimals={1}
          width={110}
          onChange={(v) => setTextStyle({ letterSpacing: v })}
        />
        <NumberField
          label={t('char.leading')}
          value={Math.round(st.lineHeight * 100)}
          min={50}
          max={400}
          unit="%"
          width={100}
          onChange={(v) => setTextStyle({ lineHeight: v / 100 })}
        />
      </div>
      <div className="picker-row">
        <button
          className="ib"
          aria-pressed={st.fontWeight >= 700}
          title={t('char.bold')}
          aria-label={t('char.bold')}
          onClick={() => setTextStyle({ fontWeight: st.fontWeight >= 700 ? 400 : 700 })}
        >
          <Icon name="bold" />
        </button>
        {toggle('italic', 'italic', t('char.italic'))}
        {toggle('underline', 'underline', t('char.underline'))}
        {toggle('strike', 'strike', t('char.strike'))}
        {toggle('uppercase', 'caps', t('char.uppercase'))}
        <span className="tsep" />
        {align('left', 'textLeft', t('char.alignLeft'))}
        {align('center', 'textCenter', t('char.alignCenter'))}
        {align('right', 'textRight', t('char.alignRight'))}
        {align('justify', 'textJustify', t('char.justify'))}
      </div>
      <div className="panel-sub">
        <span className="panel-sub-title">{t('char.features')}</span>
      </div>
      <div className="chips">
        {OPENTYPE_FEATURES.map((f) => {
          const on = st.features?.includes(f) ?? false;
          return (
            <button
              key={f}
              className="chip-btn"
              aria-pressed={on}
              data-testid={`feature-${f}`}
              title={t(`char.feature.${f}`)}
              onClick={() =>
                setTextStyle({
                  features: on ? (st.features ?? []).filter((x) => x !== f) : [...(st.features ?? []), f],
                })
              }
            >
              {t(`char.feature.${f}`)}
            </button>
          );
        })}
      </div>
      {!CANVAS_FEATURES.some((f) => st.features?.includes(f)) && st.features?.length ? (
        <p className="note small">{t('char.featureExportOnly')}</p>
      ) : null}
      <div className="panel-sub">
        <span className="panel-sub-title">{t('char.columns')}</span>
      </div>
      <div className="picker-row">
        <NumberField
          label={t('char.columnCount')}
          value={st.columns?.count ?? 1}
          min={1}
          max={12}
          width={84}
          testId="column-count"
          onChange={(count) =>
            setTextStyle({ columns: count <= 1 ? undefined : { count, gap: st.columns?.gap ?? 16 } })
          }
        />
        <NumberField
          label={t('char.columnGap')}
          value={st.columns?.gap ?? 16}
          min={0}
          max={400}
          unit="px"
          width={84}
          disabled={(st.columns?.count ?? 1) <= 1}
          onChange={(gap) => setTextStyle({ columns: { count: st.columns?.count ?? 2, gap } })}
        />
      </div>
      {text?.autoWidth && (st.columns?.count ?? 1) > 1 && (
        <p className="note small">{t('char.columnsFixed')}</p>
      )}
      {text && (
        <label className="check">
          <input
            type="checkbox"
            checked={text.autoWidth}
            onChange={(e) =>
              updateSelected(
                'history.text',
                (n) => void (n.type === 'text' && (n.autoWidth = e.target.checked)),
              )
            }
          />
          {t('char.autoWidth')}
        </label>
      )}
    </div>
  );
}
