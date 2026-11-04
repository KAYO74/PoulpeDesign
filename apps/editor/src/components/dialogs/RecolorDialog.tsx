import {
  NO_SHIFT,
  designColors,
  findArtboard,
  findNode,
  recolorDesign,
  shiftColor,
  topLevelIds,
  type PoulpeDocument,
  type RecolorShift,
  type RecolorTarget,
} from '@poulpe/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { editor } from '../../store';
import { Slider } from '../PhotoContext';
import { Modal } from './Modal';
import { close } from './close';

/*
 * Recoloriser l'illustration (comme dans Illustrator) : toutes les couleurs de la sélection (ou du
 * plan de travail) côte à côte, chacune remplaçable, et des décalages de teinte, saturation et
 * luminosité pour tout recolorer d'un coup. L'aperçu est direct ; Annuler rend le design intact.
 */

/** Ce que la fenêtre recolore : la sélection, ou sinon le plan de travail actif (fond compris). */
function targetIn(d: PoulpeDocument, ids: string[], artboardId: string | null): RecolorTarget | null {
  if (ids.length) return { nodes: ids.map((id) => findNode(d, id)?.node).filter((n) => !!n) };
  const ab = (artboardId ? findArtboard(d, artboardId) : null) ?? d.artboards[0];
  return ab ? { artboard: ab, nodes: ab.children } : null;
}

export function RecolorDialog() {
  const t = useT();
  // Cible et couleurs d'origine, lues une fois à l'ouverture.
  const [scope] = useState(() => ({
    ids: topLevelIds(editor.doc, editor.selection),
    artboardId: editor.getState().activeArtboardId ?? null,
  }));
  const colors = useMemo(() => {
    const target = targetIn(editor.doc, scope.ids, scope.artboardId);
    return target ? designColors(target) : [];
  }, [scope]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [shift, setShift] = useState<RecolorShift>(NO_SHIFT);
  const done = useRef(false);

  useEffect(() => {
    editor.preview((d) => {
      const target = targetIn(d, scope.ids, scope.artboardId);
      if (target) recolorDesign(target, mapping, shift);
    });
  }, [mapping, shift, scope]);
  // Fermée sans valider (Échap, croix) : le design revient tel qu'il était.
  useEffect(
    () => () => {
      if (!done.current) editor.cancel();
    },
    [],
  );

  const cancel = () => {
    done.current = true;
    editor.cancel();
    close();
  };
  const ok = () => {
    done.current = true;
    editor.commit('history.recolor');
    close();
  };
  const shuffle = () => {
    const pool = colors.map((c) => mapping[c] ?? c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setMapping(Object.fromEntries(colors.map((c, i) => [c, pool[i]])));
  };

  return (
    <Modal title={t('recolor.title')} onClose={cancel}>
      <p className="hint">{t(scope.ids.length ? 'recolor.hintSelection' : 'recolor.hintArtboard')}</p>
      {colors.length === 0 ? (
        <p className="note">{t('recolor.none')}</p>
      ) : (
        <div className="recolor-list" data-testid="recolor-list">
          {colors.map((c, i) => (
            <div className="picker-row" key={c}>
              <span className="chip" style={{ background: c }} title={c} aria-hidden="true" />
              <span aria-hidden="true">→</span>
              <input
                type="color"
                className="color-input"
                aria-label={t('recolor.newColor', { n: i + 1 })}
                data-testid={`recolor-color-${i}`}
                value={mapping[c] ?? c}
                onChange={(e) => setMapping((m) => ({ ...m, [c]: e.target.value }))}
              />
              <span
                className="chip"
                style={{ background: shiftColor(mapping[c] ?? c, shift) }}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      )}
      <Slider
        label={t('recolor.hue')}
        value={shift.hue}
        min={-180}
        max={180}
        unit="°"
        testId="recolor-hue"
        onChange={(hue) => setShift((s) => ({ ...s, hue }))}
      />
      <Slider
        label={t('recolor.saturation')}
        value={shift.saturation}
        min={-100}
        max={100}
        testId="recolor-saturation"
        onChange={(saturation) => setShift((s) => ({ ...s, saturation }))}
      />
      <Slider
        label={t('recolor.lightness')}
        value={shift.lightness}
        min={-100}
        max={100}
        testId="recolor-lightness"
        onChange={(lightness) => setShift((s) => ({ ...s, lightness }))}
      />
      <footer>
        <button className="btn" data-testid="recolor-shuffle" disabled={colors.length < 2} onClick={shuffle}>
          {t('recolor.shuffle')}
        </button>
        <button
          className="btn"
          data-testid="recolor-reset"
          onClick={() => {
            setMapping({});
            setShift(NO_SHIFT);
          }}
        >
          {t('recolor.reset')}
        </button>
        <button className="btn" onClick={cancel}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" onClick={ok} data-testid="recolor-go">
          {t('recolor.go')}
        </button>
      </footer>
    </Modal>
  );
}
