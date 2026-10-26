import { layoutText, type PoulpeDocument, type SceneNode, type TextNode } from '@poulpe/core';
import { getLayoutRevision, measureText } from '@poulpe/render';

/*
 * Taille des textes déjà calculée, par contenu : la normalisation passe sur tous les textes à
 * chaque commande et à chaque image d'un geste ; sans ce cache, chaque texte était remis en page
 * (mesure de chaque mot) même quand il n'avait pas changé.
 */
const sizes = new Map<string, { width: number; height: number }>();
let sizesRevision = -1;
/** Propriétés sans effet sur la taille du texte. */
const IGNORED = new Set([
  'id',
  'name',
  'x',
  'y',
  'rotation',
  'opacity',
  'blendMode',
  'visible',
  'locked',
  'fill',
  'stroke',
  'strokes',
  'effects',
  'mask',
  'filters',
]);

function textSize(n: TextNode): { width: number; height: number } {
  if (sizesRevision !== getLayoutRevision() || sizes.size > 5000) {
    sizes.clear();
    sizesRevision = getLayoutRevision();
  }
  const key = JSON.stringify(n, function (this: unknown, k: string, v: unknown) {
    return this === n && IGNORED.has(k) ? undefined : v;
  });
  let hit = sizes.get(key);
  if (!hit) {
    const layout = layoutText(n, measureText);
    hit = { width: layout.width, height: layout.height };
    sizes.set(key, hit);
  }
  return hit;
}

/**
 * Recalcule la taille des textes, qui dépend des polices du navigateur. Un texte artistique garde
 * son bord gauche, son centre ou son bord droit selon son alignement.
 */
export function normalizeTexts(doc: PoulpeDocument): void {
  // Les cadres de texte (et tous les cadres liés) gardent la taille qu'on leur a donnée.
  const linked = new Set<string>();
  const collect = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type === 'group') collect(n.children);
      else if (n.type === 'text' && n.next) linked.add(n.id).add(n.next);
    }
  };
  for (const ab of doc.artboards) collect(ab.children);
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type === 'group') visit(n.children);
      // Un texte sur tracé garde la boîte de sa courbe.
      else if (n.type === 'text' && !n.path && !n.frame && !linked.has(n.id)) {
        const layout = textSize(n);
        if (n.autoWidth) {
          const w = Math.max(1, layout.width);
          if (n.style.align === 'center') n.x += (n.width - w) / 2;
          else if (n.style.align === 'right') n.x += n.width - w;
          n.width = w;
        }
        n.height = layout.height;
      }
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
}

/** Polices utilisées par un document, au format CSS (`700 italic 16px "Oswald"`). */
export function documentFonts(doc: PoulpeDocument): string[] {
  const set = new Set<string>();
  const add = (family: string, weight: number, italic: boolean) =>
    set.add(`${italic ? 'italic ' : ''}${weight} 16px "${family}"`);
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type === 'group') visit(n.children);
      else if (n.type === 'text') {
        add(n.style.fontFamily, n.style.fontWeight, n.style.italic);
        for (const r of n.runs ?? [])
          add(
            r.style.fontFamily ?? n.style.fontFamily,
            r.style.fontWeight ?? n.style.fontWeight,
            r.style.italic ?? n.style.italic,
          );
      }
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
  return [...set];
}

/** Charge les polices d'un document avant de mesurer ou de dessiner ses textes. */
export async function loadDocumentFonts(doc: PoulpeDocument): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(documentFonts(doc).map((f) => document.fonts.load(f).catch(() => [])));
}
