import {
  chainHead,
  flowDependencies,
  flowText,
  layoutText,
  needsFlow,
  type MeasureText,
  type PageFields,
  type PoulpeDocument,
  type TextFlow,
  type TextLayout,
  type TextNode,
} from '@poulpe/core';
import { bumpRenderRevision } from './images';

/*
 * Mesure et mise en page du texte : textes seuls, chaînes de cadres liés et champs de page,
 * mémorisés tant que les objets et les polices ne changent pas.
 */

/** Révision des mesures de texte : augmente quand une police se charge. */
let layoutRevision = 0;
export function getLayoutRevision(): number {
  return layoutRevision;
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** Mesure du texte par le navigateur, partagée par le rendu, l'éditeur et l'export SVG. */
export const measureText: MeasureText = (text, font) => {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')!
        : document.createElement('canvas').getContext('2d')!;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

/*
 * Caches : les documents sont immuables, un objet inchangé garde son identité d'une image à
 * l'autre. Sa mise en page de texte et son tracé sont donc calculés une seule fois. Les objets
 * modifiables (brouillons immer) ne sont jamais mis en cache.
 */
let layoutCache = new WeakMap<TextNode, { measure: MeasureText; layout: TextLayout }>();

/** Mise en page d'un texte, mémorisée tant que l'objet ne change pas. */
export function cachedLayout(node: TextNode, measure: MeasureText = measureText): TextLayout {
  if (!Object.isFrozen(node)) return layoutText(node, measure);
  const hit = layoutCache.get(node);
  if (hit && hit.measure === measure) return hit.layout;
  const layout = layoutText(node, measure);
  layoutCache.set(node, { measure, layout });
  return layout;
}

let flowCache = new WeakMap<PoulpeDocument, Map<string, TextFlow>>();
/**
 * Répartitions par chaîne (clé : son premier cadre), avec ce dont elles dépendent : quand une
 * autre partie du document change, une chaîne dont les cadres et les objets qui l'habillent sont
 * les mêmes garde sa répartition.
 */
let chainCache = new WeakMap<TextNode, Map<string, { deps: unknown[]; flow: TextFlow }>>();

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Répartition d'un texte de mise en page (cadre, chaîne de cadres liés ou champs), mémorisée tant
 * que le document ne change pas. `fields` null : champs laissés tels quels (texte en édition).
 */
export function cachedFlow(
  doc: PoulpeDocument,
  id: string,
  fields: PageFields | null,
  measure: MeasureText = measureText,
): TextFlow {
  const head = chainHead(doc, id);
  const key = `${head?.id ?? id}|${fields ? `${fields.page}/${fields.pages}` : ''}`;
  if (!Object.isFrozen(doc) || measure !== measureText) return flowText(doc, id, measure, fields);
  let map = flowCache.get(doc);
  if (!map) flowCache.set(doc, (map = new Map()));
  let flow = map.get(key);
  if (!flow) {
    const deps = flowDependencies(doc, id);
    let per = head && Object.isFrozen(head) ? chainCache.get(head) : undefined;
    if (head && Object.isFrozen(head) && !per) chainCache.set(head, (per = new Map()));
    const hit = per?.get(key);
    if (hit && sameDeps(hit.deps, deps)) flow = hit.flow;
    else {
      flow = flowText(doc, id, measure, fields);
      per?.set(key, { deps, flow });
    }
    map.set(key, flow);
  }
  return flow;
}

/**
 * Mise en page d'un texte telle qu'affichée : seul, ou sa part d'une chaîne de cadres liés.
 * Null : le cadre n'affiche rien (tout le texte tient dans les cadres précédents).
 */
export function textLayoutIn(
  doc: PoulpeDocument,
  node: TextNode,
  opts: { measure?: MeasureText; fields?: PageFields | null; editingId?: string | null } = {},
): TextLayout | null {
  const measure = opts.measure ?? measureText;
  if (!needsFlow(doc, node)) return cachedLayout(node, measure);
  const raw = !!opts.editingId && chainHead(doc, node.id)?.id === opts.editingId;
  const flow = cachedFlow(doc, node.id, raw ? null : (opts.fields ?? null), measure);
  return flow.parts.find((p) => p.node.id === node.id)?.layout ?? null;
}

/** À appeler quand les mesures changent (une police vient de se charger). */
export function clearLayoutCache(): void {
  layoutCache = new WeakMap();
  flowCache = new WeakMap();
  chainCache = new WeakMap();
  bumpRenderRevision();
  layoutRevision++;
}
