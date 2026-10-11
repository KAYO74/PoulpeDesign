import type { RunStyle, TextNode, TextRun, TextStyle } from './types';

/**
 * Fonctions OpenType proposées dans l'interface. Les trois premières changent le dessin du texte
 * à l'écran comme à l'export ; les autres ne sont appliquées qu'à l'export (SVG, PDF) et à la
 * conversion en courbes, car la toile du navigateur ne sait pas les activer.
 */
export const OPENTYPE_FEATURES = [
  'smcp',
  'c2sc',
  'kern',
  'liga',
  'dlig',
  'onum',
  'tnum',
  'frac',
  'ss01',
] as const;
export type OpenTypeFeature = (typeof OPENTYPE_FEATURES)[number];

/** Fonctions que la toile du navigateur sait appliquer (les autres n'agissent qu'à l'export). */
export const CANVAS_FEATURES: readonly OpenTypeFeature[] = ['smcp', 'c2sc', 'kern'];

/** Valeur CSS `font-feature-settings` d'une liste de fonctions (`normal` si rien). */
export function featureSettings(features?: string[]): string {
  if (!features?.length) return 'normal';
  // `kern` est actif par défaut : l'absence de la liste ne le coupe pas à l'export.
  return features.map((f) => `"${f}" 1`).join(', ');
}

/** Mesure la largeur d'une chaîne (sans interlettrage) dans la police CSS donnée. */
export type MeasureText = (text: string, font: string) => number;

/** Style résolu d'un caractère : style du texte, éventuellement modifié par une plage. */
export type CharStyle = TextStyle & { color?: string };

/** Réglages qu'une plage peut modifier ; les autres (alignement, interligne, capitales) valent pour tout le texte. */
export const RUN_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'underline',
  'strike',
  'letterSpacing',
  'color',
] as const satisfies readonly (keyof RunStyle)[];

/** Morceau d'une ligne dans un seul style. `x` est relatif au début de la ligne, avant alignement. */
export interface TextSegment {
  start: number;
  end: number;
  text: string;
  x: number;
  width: number;
  style: CharStyle;
  font: string;
}

export interface TextLine {
  /** Indices dans `text` : début, fin visible (sans les espaces de fin) et fin de la ligne. */
  start: number;
  end: number;
  stop: number;
  text: string;
  /** Largeur, interlettrage compris. */
  width: number;
  top: number;
  height: number;
  /** Position de la ligne de base depuis le haut de la boîte. */
  baseline: number;
  /** Plus grande taille de police de la ligne. */
  size: number;
  segments: TextSegment[];
  /** Décalage horizontal dû à l'alignement. */
  offset: number;
  /** Espace ajouté à chaque blanc entre deux mots (texte justifié). */
  gap: number;
  /** Colonne de la ligne (0 s'il n'y en a qu'une). */
  column?: number;
  /** Puce ou numéro de liste, devant la première ligne d'un paragraphe. */
  marker?: TextMarker;
}

/** Puce ou numéro d'un paragraphe de liste, posé dans le retrait de sa première ligne. */
export interface TextMarker {
  text: string;
  /** Abscisse du début du repère, depuis le bord gauche de la boîte (comme `charX`). */
  x: number;
  /** Style du premier caractère du paragraphe. */
  style: CharStyle;
  font: string;
}

export interface TextLayout {
  lines: TextLine[];
  /** Hauteur de ligne du style du texte. */
  lineHeight: number;
  width: number;
  height: number;
}

type TextLike = Pick<TextNode, 'text' | 'style' | 'autoWidth' | 'width'> & {
  runs?: TextRun[];
  height?: number;
  /** Suite d'un texte dans un cadre lié : rangs de liste déjà donnés dans les cadres précédents. */
  listStart?: number;
  /** Le texte commence au milieu d'un paragraphe (sa puce est dans le cadre précédent). */
  listContinued?: boolean;
};

/** Repère d'un paragraphe de liste de rang `n` (à partir de 1). */
export function listMarker(list: NonNullable<TextStyle['list']>, n: number): string {
  return list === 'bullet' ? '•' : `${n}.`;
}

/** Retrait des lignes d'une liste, où se placent les repères ; il s'élargit pour les numéros à 3 chiffres. */
function listIndent(style: TextStyle, lastRank: number): number {
  if (!style.list) return 0;
  if (style.list === 'bullet') return style.fontSize * 1.3;
  return style.fontSize * Math.max(2, 0.6 * String(lastRank).length + 0.9);
}

/** Colonnes d'un texte : leur nombre et la largeur d'une colonne dans la boîte. */
export function textColumns(node: Pick<TextNode, 'style' | 'width' | 'autoWidth'>): {
  count: number;
  width: number;
  gap: number;
} {
  const c = node.style.columns;
  const count = node.autoWidth ? 1 : Math.max(1, Math.round(c?.count ?? 1));
  const gap = Math.max(0, c?.gap ?? 0);
  const width = count > 1 ? Math.max(1, (node.width - gap * (count - 1)) / count) : Math.max(1, node.width);
  return { count, width, gap };
}

export function cssFont(style: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>): string {
  const family = /[\s,'"]/.test(style.fontFamily)
    ? `"${style.fontFamily.replace(/"/g, '')}"`
    : style.fontFamily;
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${family}, sans-serif`;
}

/** Texte tel qu'affiché. Les capitales ne s'appliquent que si elles gardent la longueur (les indices restent valables). */
export function displayText(node: Pick<TextNode, 'text' | 'style'>): string {
  if (!node.style.uppercase) return node.text;
  const up = node.text.toUpperCase();
  return up.length === node.text.length ? up : node.text;
}

/** Mesure qui ne dépend d'aucun navigateur (tests, environnements sans canevas). */
export const approximateMeasure: MeasureText = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * size * 0.55;
};

// ————— Plages de style —————

function mergeStyle(base: TextStyle, run?: RunStyle): CharStyle {
  if (!run) return base;
  const out: CharStyle = { ...base };
  for (const k of RUN_KEYS) if (run[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = run[k];
  return out;
}

/** Style du caractère d'indice `index`. */
export function styleAt(node: Pick<TextNode, 'style'> & { runs?: TextRun[] }, index: number): CharStyle {
  const run = node.runs?.find((r) => r.start <= index && index < r.end);
  return mergeStyle(node.style, run?.style);
}

function sameRunStyle(a: RunStyle, b: RunStyle): boolean {
  return RUN_KEYS.every((k) => a[k] === b[k]);
}

/** Nettoie une liste de plages : retire ce qui égale le style du texte, les plages vides, fusionne les voisines identiques. */
export function normalizeRuns(runs: TextRun[], base: TextStyle, length: number): TextRun[] {
  const out: TextRun[] = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, r.start);
    const end = Math.min(length, r.end);
    if (end <= start) continue;
    const style: RunStyle = {};
    for (const k of RUN_KEYS) {
      const v = r.style[k];
      if (v !== undefined && v !== (base as unknown as RunStyle)[k])
        (style as Record<string, unknown>)[k] = v;
    }
    if (!Object.keys(style).length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.end === start && sameRunStyle(prev.style, style)) prev.end = end;
    else out.push({ start, end, style });
  }
  return out;
}

/** Applique `patch` aux caractères `[start, end)` ; renvoie les nouvelles plages. */
export function applyRunStyle(
  node: Pick<TextNode, 'text' | 'style'> & { runs?: TextRun[] },
  start: number,
  end: number,
  patch: RunStyle,
): TextRun[] {
  const len = node.text.length;
  const cuts = new Set([0, len, start, end]);
  for (const r of node.runs ?? []) cuts.add(r.start).add(r.end);
  const points = [...cuts].filter((c) => c >= 0 && c <= len).sort((a, b) => a - b);
  const pieces: TextRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (b <= a) continue;
    const run = node.runs?.find((r) => r.start <= a && b <= r.end);
    const style: RunStyle = { ...(run?.style ?? {}) };
    if (a >= start && b <= end) Object.assign(style, patch);
    pieces.push({ start: a, end: b, style });
  }
  return normalizeRuns(pieces, node.style, len);
}

/** Retire des plages les réglages `keys` (quand ils sont appliqués au texte entier). */
export function clearRunKeys(
  runs: TextRun[] | undefined,
  keys: string[],
  base: TextStyle,
  length: number,
): TextRun[] {
  if (!runs) return [];
  return normalizeRuns(
    runs.map((r) => {
      const style = { ...r.style } as Record<string, unknown>;
      for (const k of keys) delete style[k];
      return { ...r, style: style as RunStyle };
    }),
    base,
    length,
  );
}

/**
 * Recale les plages après une modification du texte. Le texte inséré prend le style du caractère
 * qui le précède (ou du premier caractère s'il est au début), puis `typing` s'il est donné.
 */
export function adjustRuns(
  runs: TextRun[] | undefined,
  oldText: string,
  newText: string,
  base: TextStyle,
  typing?: RunStyle,
): TextRun[] {
  let p = 0;
  const maxP = Math.min(oldText.length, newText.length);
  while (p < maxP && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < maxP - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const q = oldText.length - s;
  const ins = newText.length - s - p;
  const delta = ins - (q - p);
  const mapStart = (pos: number) =>
    pos < p || (pos === 0 && p === 0) ? pos : pos < q ? p + ins : pos + delta;
  const mapEnd = (pos: number) => (pos < p ? pos : pos <= q ? p + ins : pos + delta);
  let out = (runs ?? []).map((r) => ({ ...r, start: mapStart(r.start), end: mapEnd(r.end) }));
  out = normalizeRuns(out, base, newText.length);
  if (typing && ins > 0 && Object.keys(typing).length) {
    out = applyRunStyle({ text: newText, style: base, runs: out }, p, p + ins, typing);
  }
  return out;
}

// ————— Mise en page —————

interface StyleSpan {
  start: number;
  end: number;
  style: CharStyle;
  font: string;
}

function styleSpans(node: TextLike, length: number): StyleSpan[] {
  const runs = node.runs ?? [];
  const spans: StyleSpan[] = [];
  const baseFont = cssFont(node.style);
  let pos = 0;
  const push = (start: number, end: number, run?: RunStyle) => {
    if (end <= start) return;
    const style = mergeStyle(node.style, run);
    spans.push({ start, end, style, font: run ? cssFont(style) : baseFont });
  };
  for (const r of runs) {
    if (r.start >= length) break;
    push(pos, Math.max(pos, r.start));
    push(Math.max(pos, r.start), Math.min(length, r.end), r.style);
    pos = Math.max(pos, Math.min(length, r.end));
  }
  push(pos, length);
  if (!spans.length) spans.push({ start: 0, end: 0, style: node.style, font: baseFont });
  return spans;
}

/** Découpe le texte en lignes ; passe à la ligne sur les espaces quand le texte est un bloc. */
export function layoutText(node: TextLike, measure: MeasureText): TextLayout {
  const { style } = node;
  const text = displayText(node);
  const spans = styleSpans(node, text.length);
  const spanAt = (i: number) => {
    for (const sp of spans) if (i < sp.end) return sp;
    return spans[spans.length - 1];
  };
  const pieces = (a: number, b: number) => {
    const out: { sp: StyleSpan; a: number; b: number }[] = [];
    for (const sp of spans) {
      const x = Math.max(a, sp.start),
        y = Math.min(b, sp.end);
      if (y > x) out.push({ sp, a: x, b: y });
    }
    return out;
  };
  const w = (a: number, b: number) => {
    let sum = 0;
    for (const { sp, a: x, b: y } of pieces(a, b))
      sum += measure(text.slice(x, y), sp.font) + sp.style.letterSpacing * (y - x);
    return sum;
  };
  const trimEnd = (a: number, b: number) => {
    while (b > a && /\s/.test(text[b - 1])) b--;
    return b;
  };
  const cols = textColumns(node);
  const paras = text.split('\n');
  // Liste : toutes les lignes sont en retrait ; chaque paragraphe non vide reçoit un rang.
  let rank = node.listStart ?? 0;
  const indent = style.list ? listIndent(style, rank + paras.filter((p) => p.trim()).length) : 0;
  const maxWidth = node.autoWidth ? Infinity : Math.max(1, cols.width - indent);
  const ranges: { start: number; end: number; stop: number; last: boolean; rank: number }[] = [];
  let paraStart = 0;
  for (const [k, para] of paras.entries()) {
    const paraEnd = paraStart + para.length;
    // Le premier paragraphe d'un cadre lié qui continue le précédent a déjà sa puce.
    let paraRank = indent && para.trim() && !(k === 0 && node.listContinued) ? ++rank : 0;
    const pushLine = (a: number, stop: number, last = false) => {
      const end = trimEnd(a, stop);
      ranges.push({ start: a, end, stop, last, rank: paraRank });
      paraRank = 0;
    };
    if (!isFinite(maxWidth)) {
      pushLine(paraStart, paraEnd, true);
    } else {
      let cur = paraStart;
      let curEnd = paraStart;
      const re = /\s+|\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(para))) {
        const ts = paraStart + m.index,
          te = ts + m[0].length;
        const space = /^\s/.test(m[0]);
        if (curEnd > cur && !space && w(cur, trimEnd(cur, te)) > maxWidth) {
          pushLine(cur, ts);
          cur = ts;
          // Un mot plus long que la ligne est coupé lettre par lettre.
          while (w(cur, te) > maxWidth && te - cur > 1) {
            let cut = te - 1;
            while (cut > cur + 1 && w(cur, cut) > maxWidth) cut--;
            pushLine(cur, cut);
            cur = cut;
          }
        }
        curEnd = te;
      }
      pushLine(cur, paraEnd, true);
    }
    paraStart = paraEnd + 1;
  }

  const lines: TextLine[] = [];
  let top = 0;
  let width = 0;
  for (const r of ranges) {
    const segs: TextSegment[] = [];
    let x = 0;
    for (const { sp, a, b } of pieces(r.start, r.end)) {
      const t = text.slice(a, b);
      const sw = measure(t, sp.font) + sp.style.letterSpacing * (b - a);
      segs.push({ start: a, end: b, text: t, x, width: sw, style: sp.style, font: sp.font });
      x += sw;
    }
    // Une ligne vide prend la taille du caractère qui la précède (le retour à la ligne).
    const size = segs.length
      ? Math.max(...segs.map((sg) => sg.style.fontSize))
      : spanAt(Math.max(0, r.start - 1)).style.fontSize;
    const height = size * style.lineHeight;
    const line: TextLine = {
      start: r.start,
      end: r.end,
      stop: r.stop,
      text: text.slice(r.start, r.end),
      width: x,
      top,
      height,
      baseline: top + (height - size) / 2 + size * 0.8,
      size,
      segments: segs,
      offset: 0,
      gap: 0,
    };
    if (r.rank) {
      const sp = spanAt(r.start);
      line.marker = { text: listMarker(style.list!, r.rank), x: 0, style: sp.style, font: sp.font };
    }
    lines.push(line);
    top += height;
    width = Math.max(width, x);
  }
  // Colonnes : les lignes qui débordent de la hauteur passent dans la colonne suivante.
  if (cols.count > 1) {
    const limit = Math.max(1, node.height ?? Infinity);
    let col = 0;
    let colTop = 0;
    for (const line of lines) {
      if (col < cols.count - 1 && line.top - colTop + line.height > limit && line.top > colTop) {
        col++;
        colTop = line.top;
      }
      line.column = col;
      line.top -= colTop;
      line.baseline -= colTop;
    }
  }
  // Largeur disponible pour le texte, hors retrait de liste.
  const boxWidth = isFinite(maxWidth) ? maxWidth : Math.max(1, width);
  lines.forEach((line, i) => {
    const r = ranges[i];
    // Texte justifié : la dernière ligne d'un paragraphe suit `lastLine` (à gauche par défaut).
    let align: TextStyle['align'] = style.align;
    if (align === 'justify' && (node.autoWidth || r.last))
      align = node.autoWidth ? 'left' : (style.lastLine ?? 'left');
    if (align === 'center') line.offset = (boxWidth - line.width) / 2;
    else if (align === 'right') line.offset = boxWidth - line.width;
    else if (align === 'justify') {
      const blanks = line.text.match(/\s+/g)?.length ?? 0;
      if (blanks) line.gap = (boxWidth - line.width) / blanks;
    }
    line.offset += indent;
    if (line.column) line.offset += line.column * (cols.width + cols.gap);
    if (line.marker) line.marker.x = line.offset - indent;
  });
  const lineHeight = style.fontSize * style.lineHeight;
  const height = lines.length ? Math.max(...lines.map((l) => l.top + l.height)) : 0;
  return { lines, lineHeight, width: boxWidth + indent, height: Math.max(lineHeight, height) };
}

/** Abscisse (depuis le bord gauche de la boîte) de la frontière avant le caractère `i` d'une ligne. */
export function charX(line: TextLine, i: number, measure: MeasureText): number {
  const idx = Math.max(line.start, Math.min(i, line.end));
  let x = line.width;
  for (const sg of line.segments) {
    if (idx <= sg.end) {
      const n = idx - sg.start;
      x = sg.x + (n ? measure(sg.text.slice(0, n), sg.font) + sg.style.letterSpacing * n : 0);
      break;
    }
  }
  if (line.gap) {
    const before = line.text.slice(0, idx - line.start).match(/\s+(?=\S)/g)?.length ?? 0;
    x += before * line.gap;
  }
  return line.offset + x;
}

/** Ligne qui contient la position du curseur `i`. */
export function lineIndexAt(layout: TextLayout, i: number): number {
  for (let k = 0; k < layout.lines.length; k++) {
    const next = layout.lines[k + 1];
    if (!next || i < next.start) return k;
  }
  return layout.lines.length - 1;
}

/** Position du curseur d'indice `i`, dans le repère de la boîte du texte. */
export function caretAt(
  layout: TextLayout,
  i: number,
  measure: MeasureText,
): { x: number; top: number; height: number; line: number } {
  const k = lineIndexAt(layout, i);
  const line = layout.lines[k];
  return { x: charX(line, i, measure), top: line.top, height: line.height, line: k };
}

/** Indice du curseur le plus proche du point (repère de la boîte du texte). */
export function indexAtPoint(layout: TextLayout, x: number, y: number, measure: MeasureText): number {
  const lines = layout.lines;
  let k = lines.findIndex((l) => y < l.top + l.height);
  if (k < 0) k = lines.length - 1;
  const line = lines[k];
  let best = line.start;
  let bestD = Infinity;
  for (let i = line.start; i <= line.end; i++) {
    const d = Math.abs(charX(line, i, measure) - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
