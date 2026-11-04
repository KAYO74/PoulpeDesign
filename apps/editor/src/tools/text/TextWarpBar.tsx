import type { TextNode, TextWarp } from '@poulpe/core';
import { Select } from '../../components/fields';
import { useT } from '../../i18n';
import { editor } from '../../store';
import { setTextWarp } from '../../vectorActions';

const KINDS: TextWarp['kind'][] = ['arc', 'wave', 'circle', 'rise', 'flag'];

/** Déformation du texte (arc, vague), comme le texte déformé d'Affinity. Absent sur un texte posé sur un tracé libre. */
export function TextWarpControls({ node }: { node: TextNode }) {
  const t = useT();
  if (node.path && !node.path.warp) return null;
  const warp = node.path?.warp;
  return (
    <>
      <Select
        label={t('text.warp')}
        value={warp?.kind ?? ''}
        width={110}
        testId="text-warp"
        options={[
          { value: '', label: t('text.warpNone') },
          { value: 'arc', label: t('text.warpArc') },
          { value: 'wave', label: t('text.warpWave') },
          { value: 'circle', label: t('text.warpCircle') },
          { value: 'rise', label: t('text.warpRise') },
          { value: 'flag', label: t('text.warpFlag') },
        ]}
        onChange={(k) =>
          setTextWarp(
            KINDS.includes(k as TextWarp['kind'])
              ? { kind: k as TextWarp['kind'], bend: warp?.bend ?? 0.5 }
              : null,
          )
        }
      />
      {warp && (
        <label className="field">
          <span className="field-label">{t('text.warpBend')}</span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={Math.round(warp.bend * 100)}
            aria-label={t('text.warpBend')}
            data-testid="text-warp-bend"
            onChange={(e) => setTextWarp({ kind: warp.kind, bend: Number(e.target.value) / 100 }, true)}
            onPointerUp={() => editor.commit('history.textWarp')}
            onKeyUp={() => editor.commit('history.textWarp')}
          />
        </label>
      )}
    </>
  );
}
