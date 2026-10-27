import { memo, type ReactNode } from 'react';
import { isLinked, type TextNode, type TextStyle } from '@poulpe/core';
import { setTextStyle } from '../../actions';
import { commandShortcut, formatShortcut } from '../../commands';
import { FontPicker } from '../../components/FontPicker';
import { NumberField, Select, paintPreview } from '../../components/fields';
import { Icon, type IconName } from '../../components/Icon';
import { useFonts } from '../../fonts';
import { useT } from '../../i18n';
import { canLinkSelection, linkSelection, toggleFrame } from '../../layoutActions';
import { canSaveStyle, saveStyle } from '../../symbolActions';
import { editor, ui, useEditor, useTextSelection, useUi } from '../../store';
import { removeTextFromPath, setTextPathOffset } from '../../vectorActions';
import {
  applySavedTextStyle,
  currentTextStyle,
  isBold,
  setAlign,
  targetText,
  textStyles,
  toggleBold,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
} from './actions';
import { TextIcon, type TextIconName } from './icons';

/*
 * Barre contextuelle du texte, comme celle d'Affinity : police, style de police, taille, gras,
 * italique, souligné, barré, alignements (justifications comprises), alignement vertical d'un
 * cadre, listes, interligne, colonnes et styles de texte. Pendant l'édition, les réglages de
 * caractère s'appliquent à la sélection dans le texte.
 */

/** Styles des polices fournies avec Poulpe (voir `fonts.ts`) : graisse, et « i » pour l'italique. */
const BUNDLED_FACES: Record<string, string[]> = {
  Inter: ['400', '400i', '600', '700', '700i'],
  Montserrat: ['400', '400i', '700', '800'],
  'Playfair Display': ['400', '400i', '700'],
  Lora: ['400', '400i', '700'],
  Oswald: ['400', '700'],
  'Bricolage Grotesque': ['400', '700'],
  Pacifico: ['400'],
};
/** Autres polices : les quatre styles habituels et les graisses courantes. */
const COMMON_FACES = ['100', '200', '300', '400', '400i', '500', '600', '700', '700i', '800', '900'];

const faceKey = (st: Pick<TextStyle, 'fontWeight' | 'italic'>) => `${st.fontWeight}${st.italic ? 'i' : ''}`;

function faceOptions(family: string, current: string, t: ReturnType<typeof useT>) {
  const keys = [...(BUNDLED_FACES[family] ?? COMMON_FACES)];
  if (!keys.includes(current)) keys.push(current);
  keys.sort((a, b) => parseInt(a) - parseInt(b) || a.length - b.length);
  return keys.map((k) => {
    const w = parseInt(k);
    const name = t(`tx.weight.${w}`) === `tx.weight.${w}` ? String(w) : t(`tx.weight.${w}`);
    const label = k.endsWith('i') ? (w === 400 ? t('tx.italic') : t('tx.italicOf', { weight: name })) : name;
    return { value: k, label };
  });
}

/** Bouton à icône : son nom, avec le raccourci de sa commande, sert d'infobulle. */
function Btn({
  label,
  command,
  pressed,
  onClick,
  testId,
  children,
}: {
  label: string;
  command?: string;
  pressed?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  const shortcut = command ? commandShortcut(command) : undefined;
  const title = shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
  return (
    <button
      className="btn small icon"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

const I = ({ name }: { name: IconName }) => <Icon name={name} />;
const TI = ({ name }: { name: TextIconName }) => <TextIcon name={name} />;

/** Ce que montre la barre du texte : elle ne se redessine que si cela change. */
interface Snapshot {
  st: TextStyle;
  frame: boolean;
  onPath: boolean;
  hasNode: boolean;
  linked: boolean;
  frameChecked: boolean;
  styles: [string, string][];
  canSave: boolean;
}

/** Les réglages du texte, partagés par les outils Texte et l'outil Déplacer. */
export function TextControls({ frame }: { frame: boolean }) {
  useEditor();
  useUi((s) => s.defaults.text);
  useUi((s) => s.editingTextId);
  useTextSelection();
  const node = targetText();
  const linked = !!node && isLinked(editor.doc, node.id);
  const snapshot: Snapshot = {
    st: currentTextStyle(),
    frame,
    onPath: !!node?.path,
    hasNode: !!node,
    linked,
    frameChecked: !!node?.frame || linked,
    styles: textStyles().map((s) => [s.id, s.name]),
    canSave: !!node && canSaveStyle(),
  };
  // Pendant la frappe, chaque lettre change le document : la barre, elle, reste la même.
  return <ControlsView snapshot={JSON.stringify(snapshot)} />;
}

const ControlsView = memo(function ControlsView({ snapshot }: { snapshot: string }) {
  const { st, frame, onPath, hasNode, linked, frameChecked, styles, canSave } = JSON.parse(
    snapshot,
  ) as Snapshot;
  const t = useT();
  const fonts = useFonts();
  const families = fonts.includes(st.fontFamily) ? fonts : [st.fontFamily, ...fonts];
  const face = faceKey(st);
  const justify = st.align === 'justify';
  const last = st.lastLine ?? 'left';
  const alignBtn = (
    testId: string,
    label: string,
    icon: ReactNode,
    pressed: boolean,
    run: () => void,
    command?: string,
  ) => (
    <Btn label={label} command={command} pressed={pressed} onClick={run} testId={testId}>
      {icon}
    </Btn>
  );
  const listBtn = (kind: 'bullet' | 'number', icon: TextIconName, label: string) => (
    <Btn
      label={label}
      pressed={st.list === kind}
      onClick={() => setTextStyle({ list: st.list === kind ? undefined : kind })}
      testId={`text-list-${kind}`}
    >
      <TI name={icon} />
    </Btn>
  );
  const valign = (v: 'top' | 'center' | 'bottom', icon: TextIconName, label: string) => (
    <Btn
      label={label}
      pressed={(st.verticalAlign ?? 'top') === v}
      onClick={() => setTextStyle({ verticalAlign: v === 'top' ? undefined : v })}
      testId={`text-valign-${v}`}
    >
      <TI name={icon} />
    </Btn>
  );
  return (
    <>
      <FontPicker
        label={t('char.font')}
        value={st.fontFamily}
        fonts={families}
        onChange={(f) => setTextStyle({ fontFamily: f })}
        width={150}
        testId="text-font"
      />
      <Select
        label={t('tx.face')}
        value={face}
        options={faceOptions(st.fontFamily, face, t)}
        onChange={(k) => setTextStyle({ fontWeight: parseInt(k), italic: k.endsWith('i') })}
        width={140}
        testId="text-face"
      />
      <NumberField
        label={t('char.size')}
        value={st.fontSize}
        min={1}
        max={2000}
        unit="px"
        decimals={1}
        width={78}
        onChange={(v) => setTextStyle({ fontSize: v })}
        testId="text-size"
      />
      <span className="ctx-group">
        <Btn
          label={t('char.bold')}
          command="text.bold"
          pressed={isBold(st)}
          onClick={toggleBold}
          testId="text-bold"
        >
          <I name="bold" />
        </Btn>
        <Btn
          label={t('char.italic')}
          command="text.italic"
          pressed={st.italic}
          onClick={toggleItalic}
          testId="text-italic"
        >
          <I name="italic" />
        </Btn>
        <Btn
          label={t('char.underline')}
          command="text.underline"
          pressed={st.underline}
          onClick={toggleUnderline}
          testId="text-underline"
        >
          <I name="underline" />
        </Btn>
        <Btn label={t('char.strike')} pressed={st.strike} onClick={toggleStrike} testId="text-strike">
          <I name="strike" />
        </Btn>
      </span>
      <span className="ctx-group">
        {alignBtn(
          'text-align-left',
          t('char.alignLeft'),
          <I name="textLeft" />,
          st.align === 'left',
          () => setAlign('left'),
          'text.alignLeft',
        )}
        {alignBtn(
          'text-align-center',
          t('char.alignCenter'),
          <I name="textCenter" />,
          st.align === 'center',
          () => setAlign('center'),
          'text.alignCenter',
        )}
        {alignBtn(
          'text-align-right',
          t('char.alignRight'),
          <I name="textRight" />,
          st.align === 'right',
          () => setAlign('right'),
          'text.alignRight',
        )}
        {!onPath && (
          <>
            {alignBtn(
              'text-justify-left',
              t('tx.justifyLeft'),
              <TI name="justifyLeft" />,
              justify && last === 'left',
              () => setAlign('justify', 'left'),
              'text.justify',
            )}
            {alignBtn(
              'text-justify-center',
              t('tx.justifyCenter'),
              <TI name="justifyCenter" />,
              justify && last === 'center',
              () => setAlign('justify', 'center'),
            )}
            {alignBtn(
              'text-justify-right',
              t('tx.justifyRight'),
              <TI name="justifyRight" />,
              justify && last === 'right',
              () => setAlign('justify', 'right'),
            )}
            {alignBtn(
              'text-justify-all',
              t('tx.justifyAll'),
              <TI name="justifyAll" />,
              justify && last === 'justify',
              () => setAlign('justify', 'justify'),
            )}
          </>
        )}
      </span>
      {frame && !onPath && (
        <span className="ctx-group">
          {valign('top', 'valignTop', t('tx.valignTop'))}
          {valign('center', 'valignCenter', t('tx.valignCenter'))}
          {valign('bottom', 'valignBottom', t('tx.valignBottom'))}
        </span>
      )}
      {!onPath && (
        <span className="ctx-group">
          {listBtn('bullet', 'bullets', t('tx.bullets'))}
          {listBtn('number', 'numbers', t('tx.numbers'))}
        </span>
      )}
      {!onPath && (
        <NumberField
          label={t('char.leading')}
          value={Math.round(st.lineHeight * 100)}
          min={50}
          max={400}
          unit="%"
          width={78}
          onChange={(v) => setTextStyle({ lineHeight: v / 100 })}
          testId="text-leading"
        />
      )}
      {frame && !onPath && (
        <>
          <NumberField
            label={t('tx.columns')}
            value={st.columns?.count ?? 1}
            min={1}
            max={12}
            width={62}
            testId="text-columns"
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
            width={78}
            disabled={(st.columns?.count ?? 1) <= 1}
            testId="text-gutter"
            onChange={(gap) => setTextStyle({ columns: { count: st.columns?.count ?? 2, gap } })}
          />
        </>
      )}
      <Select
        label={t('tx.styles')}
        value=""
        testId="text-styles"
        width={190}
        options={[
          { value: '', label: styles.length ? t('tx.stylesPick') : t('tx.stylesNone') },
          ...styles.map(([value, label]) => ({ value, label })),
          ...(canSave ? [{ value: '__save', label: `+ ${t('tx.stylesSave')}` }] : []),
        ]}
        onChange={(id) => {
          if (id === '__save') saveStyle();
          else if (id) applySavedTextStyle(id);
        }}
      />
      {hasNode && !onPath && (
        <label className="check" title={t('ctx.frameHint')}>
          <input
            type="checkbox"
            data-testid="text-frame"
            checked={frameChecked}
            disabled={linked}
            onChange={toggleFrame}
          />
          {t('ctx.frame')}
        </label>
      )}
    </>
  );
});

/** Le texte visé est-il un cadre (ou le sera-t-il, avec l'outil Cadre de texte) ? */
function isFrame(node: TextNode | null): boolean {
  if (node) return !node.path && (!!node.frame || isLinked(editor.doc, node.id));
  return ui.get().tool === 'frameText';
}

/** Couleur du texte : la pastille règle le remplissage dans le panneau Couleur. */
function TextColor({ node }: { node: TextNode }) {
  const t = useT();
  const target = useUi((s) => s.colorTarget);
  const color = currentTextStyle() as TextStyle & { color?: string };
  const paint = color.color ? { type: 'solid' as const, color: color.color } : node.fill;
  return (
    <button
      className={`chip${target === 'fill' ? ' on' : ''}`}
      style={{ background: paintPreview(paint) }}
      aria-label={t('tx.color')}
      title={t('tx.color')}
      onClick={() => ui.set({ colorTarget: 'fill' })}
    />
  );
}

/** Barre des outils Texte artistique et Cadre de texte. */
export function TextContext() {
  const t = useT();
  const { selection } = useEditor();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.editingTextId);
  const node = targetText();
  const single = selection.length === 1 ? node : null;
  return (
    <>
      <span className="ctx-dim">
        {node ? node.name : t(tool === 'frameText' ? 'tx.newFrame' : 'tx.newText')}
      </span>
      {node && <TextColor node={node} />}
      <TextControls frame={isFrame(node)} />
      {single?.path && (
        <>
          <label className="field">
            <span className="field-label">{t('ctx.pathOffset')}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={Math.round(single.path.offset * 1000) / 10}
              aria-label={t('ctx.pathOffset')}
              onChange={(e) => setTextPathOffset(Number(e.target.value) / 100, true)}
              onPointerUp={() => editor.commit('history.textPath')}
              onKeyUp={() => editor.commit('history.textPath')}
            />
          </label>
          <button className="btn small" onClick={removeTextFromPath}>
            {t('text.offPath')}
          </button>
        </>
      )}
      {canLinkSelection() && (
        <button className="btn small" onClick={linkSelection}>
          {t('text.link')}
        </button>
      )}
    </>
  );
}

/** Outil Déplacer avec un texte sélectionné (ou en édition) : les réglages du texte en fin de barre. */
export function TextExtra() {
  const tool = useUi((s) => s.tool);
  useEditor();
  useUi((s) => s.editingTextId);
  if (tool !== 'select') return null;
  const node = targetText();
  if (!node) return null;
  return (
    <>
      <span className="tsep" />
      <TextControls frame={isFrame(node)} />
    </>
  );
}
