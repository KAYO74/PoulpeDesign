import { useSyncExternalStore } from 'react';
import { findNode, type AutoSelect, type StyleParts } from '@poulpe/core';
import { align, distribute, groupSelection, ungroupSelection } from '../../actions';
import { Icon, type IconName } from '../../components/Icon';
import { Select, paintPreview } from '../../components/fields';
import { useT } from '../../i18n';
import { editor, ui, useStore, useUi } from '../../store';
import { finishVectorCrop, resetVectorCrop, selectedVectorCrop, unloadStyle } from './actions';
import { moveState } from './state';

/* Barres contextuelles : options de l'outil Déplacer, Recadrage vectoriel et Pipette de style. */

/**
 * Nombre d'objets sélectionnés, groupe ou recadrage sélectionné seul. Lu d'un coup (une chaîne),
 * et seulement pour les outils qui s'en servent : la barre ne relit pas le document à chaque image.
 */
function useSelectionInfo(): { count: number; group: boolean; crop: boolean } {
  const key = useSyncExternalStore(editor.subscribe, () => {
    const tool = ui.get().tool;
    if (tool !== 'select' && tool !== 'vectorCrop') return '0';
    const sel = editor.selection;
    const only = sel.length === 1 ? findNode(editor.doc, sel[0])?.node : null;
    return `${sel.length}|${only?.type === 'group' ? 'g' : ''}${selectedVectorCrop() ? 'c' : ''}`;
  });
  const [count, kind = ''] = key.split('|');
  return { count: Number(count), group: kind.includes('g'), crop: kind.includes('c') };
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  testId: string;
}) {
  return (
    <button
      className="btn small icon"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon name={icon} />
    </button>
  );
}

const ALIGN: [IconName, Parameters<typeof align>[0], string][] = [
  ['alignLeft', 'left', 'arrange.alignLeft'],
  ['alignHCenter', 'hcenter', 'arrange.alignHCenter'],
  ['alignRight', 'right', 'arrange.alignRight'],
  ['alignTop', 'top', 'arrange.alignTop'],
  ['alignVCenter', 'vcenter', 'arrange.alignVCenter'],
  ['alignBottom', 'bottom', 'arrange.alignBottom'],
];

/**
 * Options de l'outil Déplacer, comme dans Affinity : sélection automatique, point d'origine,
 * transformer séparément, alignement et groupes. Ajoutées au bout de la barre par défaut.
 */
export function MoveExtra() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const autoSelect = useStore(moveState, (s) => s.autoSelect);
  const showOrigin = useStore(moveState, (s) => s.showOrigin);
  const separately = useStore(moveState, (s) => s.separately);
  const { count, group } = useSelectionInfo();
  if (tool !== 'select') return null;
  return (
    <>
      <Select<AutoSelect>
        label={t('move.autoSelect')}
        value={autoSelect}
        testId="move-autoselect"
        width={180}
        options={(['layer', 'group', 'object'] as const).map((v) => ({
          value: v,
          label: t(`move.autoSelect.${v}`),
        }))}
        onChange={(v) => moveState.set({ autoSelect: v })}
      />
      <span className="ctx-group">
        <IconBtn
          icon="transformOrigin"
          label={t('move.origin')}
          pressed={showOrigin}
          onClick={() => moveState.set({ showOrigin: !showOrigin, origin: null })}
          testId="move-origin"
        />
        <IconBtn
          icon="transformSeparately"
          label={t('move.separately')}
          pressed={separately}
          onClick={() => moveState.set({ separately: !separately })}
          testId="move-separately"
        />
      </span>
      <span className="ctx-group">
        {ALIGN.map(([icon, mode, label]) => (
          <IconBtn
            key={mode}
            icon={icon}
            label={t(label)}
            disabled={!count}
            onClick={() => align(mode)}
            testId={`move-align-${mode}`}
          />
        ))}
      </span>
      <span className="ctx-group">
        <IconBtn
          icon="distributeH"
          label={t('arrange.distributeH')}
          disabled={count < 3}
          onClick={() => distribute('h')}
          testId="move-distribute-h"
        />
        <IconBtn
          icon="distributeV"
          label={t('arrange.distributeV')}
          disabled={count < 3}
          onClick={() => distribute('v')}
          testId="move-distribute-v"
        />
      </span>
      <span className="ctx-group">
        <IconBtn
          icon="group"
          label={t('layer.group')}
          disabled={!count}
          onClick={groupSelection}
          testId="move-group"
        />
        <IconBtn
          icon="ungroup"
          label={t('layer.ungroup')}
          disabled={!group}
          onClick={ungroupSelection}
          testId="move-ungroup"
        />
      </span>
    </>
  );
}

/** Barre du Recadrage vectoriel : réinitialiser le recadrage, terminer. */
export function VectorCropBar() {
  const t = useT();
  const { count, crop } = useSelectionInfo();
  return (
    <>
      <span className="ctx-dim">{t(count ? 'vcrop.hint' : 'vcrop.empty')}</span>
      <button className="btn small" disabled={!crop} onClick={resetVectorCrop} data-testid="vcrop-reset">
        {t('vcrop.reset')}
      </button>
      <button className="btn small" disabled={!count} onClick={finishVectorCrop} data-testid="vcrop-done">
        {t('vcrop.done')}
      </button>
    </>
  );
}

const PARTS: (keyof StyleParts)[] = ['fill', 'stroke', 'effects', 'text'];

/** Barre de la Pipette de style : style chargé, parties à appliquer, décharger. */
export function StylePickerBar() {
  const t = useT();
  const picked = useStore(moveState, (s) => s.picked);
  const parts = useStore(moveState, (s) => s.parts);
  return (
    <>
      {picked ? (
        <span className="move-style" data-testid="sp-loaded">
          <span className="ctx-label">{t('stylePicker.loadedLabel')}</span>
          {picked.fill && (
            <span
              className="chip"
              style={{ background: paintPreview(picked.fill) }}
              title={t('ctx.fill')}
              aria-label={t('ctx.fill')}
            />
          )}
          {picked.stroke && (
            <span
              className="chip ring"
              style={{ background: paintPreview(picked.stroke.paint) }}
              title={t('ctx.stroke')}
              aria-label={t('ctx.stroke')}
            />
          )}
          <span className="ctx-dim">
            {[
              picked.text?.fontFamily,
              picked.effects?.length ? t('stylePicker.effectsCount', { n: picked.effects.length }) : '',
              picked.opacity !== undefined && picked.opacity < 1
                ? `${Math.round(picked.opacity * 100)} %`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      ) : (
        <span className="ctx-dim">{t('stylePicker.empty')}</span>
      )}
      <span className="ctx-label">{t('stylePicker.apply')}</span>
      {PARTS.map((k) => (
        <label key={k} className="check">
          <input
            type="checkbox"
            data-testid={`sp-${k}`}
            checked={parts[k]}
            onChange={() => moveState.set({ parts: { ...parts, [k]: !parts[k] } })}
          />
          {t(`stylePicker.part.${k}`)}
        </label>
      ))}
      <button className="btn small" disabled={!picked} onClick={unloadStyle} data-testid="sp-unload">
        {t('stylePicker.unload')}
      </button>
    </>
  );
}
