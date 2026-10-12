import { adjustRuns, layoutText, type MeasureText, type TextLayout, type TextLine } from './text';
import { layoutInRegion } from './textRegion';
import { frameRegion, wrapObstacles, wrapSources } from './textWrap';
import { walkDocument } from './tree';
import type { PoulpeDocument, TextNode, TextRun, TextStyle } from './types';

/*
 * Textes de mise en page : champs (numéro de page, nombre de pages) et cadres de texte liés.
 *
 * Un cadre de texte (`frame`) garde sa hauteur : ce qui ne tient pas passe dans le cadre suivant
 * (`next`), et ainsi de suite. Le premier cadre de la chaîne porte le texte, le style et les
 * plages ; les indices des lignes de chaque cadre restent ceux du texte complet, ce qui permet
 * d'éditer toute la chaîne comme un seul texte.
 */

/** Champs remplacés à l'affichage. */
export const FIELD_PAGE = '{page}';
export const FIELD_PAGES = '{pages}';
const FIELD_RE = /\{pages?\}/g;

/** Valeurs des champs sur une page : numéro et nombre de pages (« # » sur une page maître). */
export interface PageFields {
  page: string;
  pages: string;
}

export function hasFields(text: string): boolean {
  return text.includes(FIELD_PAGE) || text.includes(FIELD_PAGES);
}

/** Remplace les champs d'un texte ; les plages de style suivent. Renvoie l'objet tel quel s'il n'en a pas. */
export function resolveFields<T extends Pick<TextNode, 'text' | 'style' | 'runs'>>(
  node: T,
  fields: PageFields,
): T {
  if (!hasFields(node.text)) return node;
  let text = node.text;
  let runs: TextRun[] | undefined = node.runs;
  for (;;) {
    FIELD_RE.lastIndex = 0;
    const m = FIELD_RE.exec(text);
    if (!m) break;
    const value = m[0] === FIELD_PAGE ? fields.page : fields.pages;
    const next = text.slice(0, m.index) + value + text.slice(m.index + m[0].length);
    if (runs?.length) runs = adjustRuns(runs, text, next, node.style);
    text = next;
  }
  const out = { ...node, text };
  if (runs?.length) out.runs = runs;
  else delete out.runs;
  return out;
}

// ————— Chaînes de cadres —————

interface Links {
  texts: Map<string, TextNode>;
  prev: Map<string, string>;
}

const linksCache = new WeakMap<PoulpeDocument, Links>();

function links(doc: PoulpeDocument): Links {
  const frozen = Object.isFrozen(doc);
  const hit = frozen ? linksCache.get(doc) : undefined;
  if (hit) return hit;
  const texts = new Map<string, TextNode>();
  for (const { node } of walkDocument(doc)) if (node.type === 'text') texts.set(node.id, node);
  const prev = new Map<string, string>();
  for (const t of texts.values()) {
    // Un cadre n'a qu'un précédent : un second lien vers lui est ignoré.
    if (t.next && t.next !== t.id && texts.has(t.next) && !prev.has(t.next)) prev.set(t.next, t.id);
  }
  const out = { texts, prev };
  if (frozen) linksCache.set(doc, out);
  return out;
}

/** Cadres de la chaîne qui contient ce texte, du premier au dernier (le texte seul s'il n'est pas lié). */
export function textChain(doc: PoulpeDocument, id: string): TextNode[] {
  const { texts, prev } = links(doc);
  const start = texts.get(id);
  if (!start) return [];
  let head = start;
  const back = new Set([head.id]);
  for (let p = prev.get(head.id); p && !back.has(p); p = prev.get(p)) {
    back.add(p);
    head = texts.get(p)!;
  }
  const chain: TextNode[] = [];
  const seen = new Set<string>();
  for (let n: TextNode | undefined = head; n && !seen.has(n.id);) {
    seen.add(n.id);
    chain.push(n);
    const nextId: string | undefined = n.next;
    n = nextId && prev.get(nextId) === n.id ? texts.get(nextId) : undefined;
  }
  return chain;
}

/** Premier cadre (celui qui porte le texte) de la chaîne de ce texte. */
export function chainHead(doc: PoulpeDocument, id: string): TextNode | null {
  return textChain(doc, id)[0] ?? null;
}

/** Ce texte fait-il partie d'une chaîne de cadres liés ? */
export function isLinked(doc: PoulpeDocument, id: string): boolean {
  return textChain(doc, id).length > 1;
}

/** Ce texte demande-t-il une mise en page propre à la mise en page (cadre, chaîne ou champs) ? */
export function needsFlow(doc: PoulpeDocument, node: TextNode): boolean {
  return !!node.frame || !!node.next || links(doc).prev.has(node.id) || hasFields(node.text);
}

/** Partie du texte affichée dans un cadre ; les indices sont ceux du texte complet. */
export interface FlowPart {
  node: TextNode;
  layout: TextLayout;
  start: number;
  end: number;
}

export interface TextFlow {
  /** Texte complet (champs remplacés), tel que réparti dans les cadres. */
  text: string;
  parts: FlowPart[];
  /** Du texte ne tient dans aucun cadre. */
  overflow: boolean;
}

function shiftLine(line: TextLine, o: number): TextLine {
  if (!o) return line;
  return {
    ...line,
    start: line.start + o,
    end: line.end + o,
    stop: line.stop + o,
    segments: line.segments.map((s) => ({ ...s, start: s.start + o, end: s.end + o })),
  };
}

/**
 * Liste qui continue dans un cadre lié : nombre de paragraphes numérotés avant `offset`, et le
 * cadre commence-t-il au milieu d'un paragraphe (dont la puce est dans le cadre précédent) ?
 */
function listFrom(
  text: string,
  offset: number,
  list: boolean,
): { listStart?: number; listContinued?: boolean } {
  if (!list || !offset) return {};
  let count = 0;
  let pos = 0;
  for (const para of text.split('\n')) {
    if (pos >= offset) break;
    if (para.trim()) count++;
    pos += para.length + 1;
  }
  return { listStart: count, listContinued: text[offset - 1] !== '\n' };
}

/**
 * Alignement vertical dans un cadre de hauteur fixe : les lignes de chaque colonne descendent
 * au milieu ou en bas du cadre.
 */
export function alignVertically(
  lines: TextLine[],
  height: number,
  align: TextStyle['verticalAlign'],
): TextLine[] {
  if (!align || align === 'top' || !lines.length) return lines;
  const k = align === 'center' ? 0.5 : 1;
  const bottoms = new Map<number, number>();
  for (const l of lines) {
    const c = l.column ?? 0;
    bottoms.set(c, Math.max(bottoms.get(c) ?? 0, l.top + l.height));
  }
  return lines.map((l) => {
    const shift = Math.max(0, (height - bottoms.get(l.column ?? 0)!) * k);
    return shift ? { ...l, top: l.top + shift, baseline: l.baseline + shift } : l;
  });
}

function sliceRuns(runs: TextRun[] | undefined, from: number): TextRun[] | undefined {
  if (!runs?.length || !from) return runs;
  const out = runs
    .filter((r) => r.end > from)
    .map((r) => ({ ...r, start: Math.max(0, r.start - from), end: r.end - from }));
  return out.length ? out : undefined;
}

/** Texte d'une chaîne à partir de `offset`, tel qu'un cadre le met en page. */
function textFrom(
  src: Pick<TextNode, 'style' | 'runs'>,
  text: string,
  offset: number,
  frame: TextNode,
  autoWidth: boolean,
) {
  return {
    text: text.slice(offset),
    style: src.style,
    runs: sliceRuns(src.runs, offset),
    autoWidth,
    width: frame.width,
    // La hauteur du cadre répartit les lignes entre ses colonnes.
    height: frame.height,
    ...listFrom(text, offset, !!src.style.list),
  };
}

/**
 * Part d'un cadre de texte (hauteur fixe) : les lignes se posent dans sa zone (colonnes, marges
 * intérieures, forme, objets qui l'habillent) à partir de l'indice `offset` du texte.
 */
export function framePart(
  doc: PoulpeDocument,
  frame: TextNode,
  src: Pick<TextNode, 'style' | 'runs'>,
  text: string,
  offset: number,
  measure: MeasureText,
): FlowPart {
  const sub = textFrom(src, text, offset, frame, false);
  const region = frameRegion(frame, src.style, wrapObstacles(doc, frame));
  let lay = layoutInRegion(sub, measure, region);
  const v = src.style.verticalAlign;
  if (v && v !== 'top' && lay.lines.length) {
    if (!region.shaped) lay = { ...lay, lines: alignVertically(lay.lines, region.bottom, v) };
    else if (region.columns === 1) {
      // Zone habillée ou de forme : on recommence plus bas, tant que le même texte y tient.
      const k = v === 'center' ? 0.5 : 1;
      let shift = (region.bottom - Math.max(...lay.lines.map((l) => l.top + l.height))) * k;
      for (let n = 0; n < 4 && shift > 0.5; n++, shift /= 2) {
        const again = layoutInRegion(sub, measure, region, region.top + shift);
        if (again.end === lay.end) {
          lay = again;
          break;
        }
      }
    }
  }
  return {
    node: frame,
    layout: {
      lines: lay.lines.map((l) => shiftLine(l, offset)),
      lineHeight: lay.lineHeight,
      width: lay.width,
      height: frame.height,
    },
    start: offset,
    end: offset + lay.end,
  };
}

/**
 * Répartit le texte d'une chaîne dans ses cadres. `fields` : valeurs des champs, ou null pour
 * garder les champs tels quels (texte en cours d'édition).
 */
export function flowText(
  doc: PoulpeDocument,
  id: string,
  measure: MeasureText,
  fields: PageFields | null,
): TextFlow {
  const chain = textChain(doc, id);
  const head = chain[0];
  if (!head) return { text: '', parts: [], overflow: false };
  const src = fields ? resolveFields(head, fields) : head;
  const text = src.text;
  const parts: FlowPart[] = [];
  let offset = 0;
  for (let i = 0; i < chain.length; i++) {
    const frame = chain[i];
    // Cadre de texte : sa hauteur est fixe, ce qui ne tient pas passe au cadre suivant.
    if (frame.frame || chain.length > 1) {
      const part = framePart(doc, frame, src, text, offset, measure);
      parts.push(part);
      offset = part.end;
      continue;
    }
    const sub = textFrom(src, text, offset, frame, head.autoWidth);
    const full = layoutText(sub, measure);
    let lines = full.lines.map((l) => shiftLine(l, offset));
    // Texte artistique dont les champs ont changé la longueur : l'alignement suit sa boîte.
    const k = src.style.align === 'center' ? 0.5 : src.style.align === 'right' ? 1 : 0;
    if (sub.autoWidth && k && frame.width !== full.width) {
      const dx = (frame.width - full.width) * k;
      lines = lines.map((l) => ({
        ...l,
        offset: l.offset + dx,
        marker: l.marker && { ...l.marker, x: l.marker.x + dx },
      }));
    }
    parts.push({
      node: frame,
      layout: { lines, lineHeight: full.lineHeight, width: full.width, height: full.height },
      start: offset,
      end: text.length,
    });
    offset = text.length;
  }
  // Une ligne vide en fin de texte (après un retour à la ligne) ne compte pas comme débordement.
  const overflow = offset < text.length && text.slice(offset).trim() !== '';
  return { text, parts, overflow };
}

/**
 * Ce dont dépend la répartition d'une chaîne, hors champs et polices : ses cadres et, pour chacun,
 * les objets qui l'habillent. Tant que la liste est la même (objets comparés par référence), la
 * répartition déjà calculée reste bonne.
 */
export function flowDependencies(doc: PoulpeDocument, id: string): unknown[] {
  const chain = textChain(doc, id);
  const out: unknown[] = [];
  for (const f of chain) {
    out.push(f);
    if (f.frame || chain.length > 1) out.push(...wrapSources(doc, f));
  }
  return out;
}
