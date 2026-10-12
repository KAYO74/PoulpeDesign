import {
  displayText,
  listIndent,
  listMarker,
  styleSpans,
  type MeasureText,
  type StyleSpan,
  type TextLayout,
  type TextLike,
  type TextLine,
  type TextSegment,
} from './text';
import type { TextStyle } from './types';

/*
 * Mise en page d'un cadre de texte, ligne par ligne, dans une zone qui n'est pas forcément un
 * rectangle : chaque ligne demande à la zone les places libres à sa hauteur (entre les objets qui
 * habillent le cadre, dans sa forme, dans sa colonne) et le texte les remplit de gauche à droite,
 * comme dans Affinity Publisher. La mise en page s'arrête quand la zone est pleine : la suite du
 * texte passe dans le cadre suivant.
 *
 * Les règles de coupure sont celles de `layoutText` : sans habillage, les lignes sont les mêmes.
 */

/** Zone où se posent les lignes d'un cadre, dans le repère de sa boîte. */
export interface TextRegion {
  columns: number;
  /** Haut et bas de la zone (marges intérieures déduites). */
  top: number;
  bottom: number;
  /** Largeur d'une colonne sans obstacle : un mot plus large est coupé. */
  widest: number;
  /** Places libres de la bande horizontale [y0, y1] de la colonne `col`, de gauche à droite. */
  slots(col: number, y0: number, y1: number): [number, number][];
  /** La zone n'est pas un simple rectangle par colonne (habillage ou forme). */
  shaped: boolean;
}

export interface RegionLayout extends TextLayout {
  /** Fin (exclue) du texte posé : ce qui suit ne tient pas dans la zone. */
  end: number;
}

/**
 * Pose le texte dans la zone, à partir de la hauteur `startY` (le haut de la zone par défaut).
 * Les indices des lignes sont ceux de `node.text`.
 */
export function layoutInRegion(
  node: TextLike,
  measure: MeasureText,
  region: TextRegion,
  startY = region.top,
): RegionLayout {
  const { style } = node;
  const text = displayText(node);
  const spans = styleSpans(node, text.length);
  const spanAt = (i: number): StyleSpan => {
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

  const lh = style.lineHeight;
  const paras = text.split('\n');
  let rank = node.listStart ?? 0;
  const indent = style.list ? listIndent(style, rank + paras.filter((p) => p.trim()).length) : 0;
  const lines: TextLine[] = [];

  // Bande en cours : sa hauteur, les places qui restent et ce qui y est déjà posé.
  let col = 0;
  let y = startY;
  let band: { top: number; height: number; queue: [number, number][]; used: boolean } | null = null;

  /** Prochaine place pour une ligne de hauteur `h`, ou null si la zone est pleine. */
  const nextSlot = (h: number, size: number): { x0: number; x1: number; top: number } | null => {
    if (band?.queue.length) {
      const [x0, x1] = band.queue.shift()!;
      return { x0, x1, top: band.top };
    }
    // Rien de posé dans la bande (places trop étroites) : on descend un peu.
    if (band) y = band.top + (band.used ? band.height : Math.max(0.5, h / 5));
    band = null;
    // Une petite place entre deux objets ne reçoit pas de texte (sauf si la colonne est ainsi).
    const min = Math.min(indent + size * 1.5, region.widest - 0.5);
    for (;;) {
      if (y + h > region.bottom + 0.5) {
        if (col < region.columns - 1) {
          col++;
          y = region.top;
          continue;
        }
        return null;
      }
      const queue = region.slots(col, y, y + h).filter(([a, b]) => b - a >= min);
      if (queue.length) {
        band = { top: y, height: 0, queue, used: false };
        const [x0, x1] = queue.shift()!;
        return { x0, x1, top: y };
      }
      y += Math.max(0.5, h / 5);
    }
  };

  /**
   * Fin de la ligne qui commence en `cur` dans une place de largeur `avail` (mêmes règles que
   * `layoutText`), ou null si son premier mot n'y tient pas et tiendra dans une place plus large.
   */
  const fit = (cur: number, paraStart: number, paraEnd: number, avail: number, full: boolean) => {
    const re = /\s+|\S+/g;
    const s = text.slice(cur, paraEnd);
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (/^\s/.test(m[0])) continue;
      const ts = cur + m.index,
        te = ts + m[0].length;
      if (w(cur, te) <= avail) continue;
      if (ts > cur) return ts;
      // Le premier mot de la ligne est trop large pour cette place.
      if (!full && w(ts, te) <= region.widest - indent) return null;
      if (cur === paraStart && full) {
        // Premier mot d'un paragraphe : gardé entier, comme `layoutText`.
        let e = te;
        while (e < paraEnd && /\s/.test(text[e])) e++;
        return e;
      }
      // Coupé lettre par lettre.
      let cut = te - 1;
      while (cut > cur + 1 && w(cur, cut) > avail) cut--;
      return cut;
    }
    return paraEnd;
  };

  const sizeOf = (cur: number, paraEnd: number) =>
    (cur < paraEnd ? spanAt(cur) : spanAt(Math.max(0, cur - 1))).style.fontSize;

  /** Pose une ligne ; renvoie où elle s'arrête, ou null si la zone est pleine. */
  const place = (cur: number, paraStart: number, paraEnd: number, lineRank: number): number | null => {
    let size = sizeOf(cur, paraEnd);
    let retried = false;
    for (;;) {
      const slot = nextSlot(size * lh, size);
      if (!slot) return null;
      const room = slot.x1 - slot.x0;
      const avail = Math.max(1, room - indent);
      const full = room >= region.widest - 0.5;
      let stop = cur;
      if (cur < paraEnd) {
        const r = fit(cur, paraStart, paraEnd, avail, full);
        if (r === null) continue;
        stop = r;
      }
      const end = trimEnd(cur, stop);
      const segs: TextSegment[] = [];
      let x = 0;
      for (const { sp, a, b } of pieces(cur, end)) {
        const t = text.slice(a, b);
        const sw = measure(t, sp.font) + sp.style.letterSpacing * (b - a);
        segs.push({ start: a, end: b, text: t, x, width: sw, style: sp.style, font: sp.font });
        x += sw;
      }
      const real = segs.length ? Math.max(...segs.map((sg) => sg.style.fontSize)) : size;
      const b = band!;
      if (real > size + 1e-9 && !b.used && !retried) {
        // Ligne plus haute que prévu : on reprend la bande à sa vraie hauteur.
        y = b.top;
        band = null;
        size = real;
        retried = true;
        continue;
      }
      const height = real * lh;
      const line: TextLine = {
        start: cur,
        end,
        stop,
        text: text.slice(cur, end),
        width: x,
        top: slot.top,
        height,
        baseline: slot.top + (height - real) / 2 + real * 0.8,
        size: real,
        segments: segs,
        offset: 0,
        gap: 0,
        slot: [slot.x0, slot.x1],
      };
      if (region.columns > 1) line.column = col;
      // Alignement dans la place ; la dernière ligne d'un paragraphe justifié suit `lastLine`.
      let align: TextStyle['align'] = style.align;
      if (align === 'justify' && stop >= paraEnd) align = style.lastLine ?? 'left';
      if (align === 'center') line.offset = (avail - x) / 2;
      else if (align === 'right') line.offset = avail - x;
      else if (align === 'justify') {
        const blanks = line.text.match(/\s+/g)?.length ?? 0;
        if (blanks) line.gap = (avail - x) / blanks;
      }
      line.offset += slot.x0 + indent;
      if (lineRank) {
        const sp = spanAt(cur);
        line.marker = {
          text: listMarker(style.list!, lineRank),
          x: line.offset - indent,
          style: sp.style,
          font: sp.font,
        };
      }
      lines.push(line);
      b.used = true;
      b.height = Math.max(b.height, height);
      return stop;
    }
  };

  let end = text.length;
  let paraStart = 0;
  outer: for (const [k, para] of paras.entries()) {
    const paraEnd = paraStart + para.length;
    // Le premier paragraphe d'un cadre lié qui continue le précédent a déjà sa puce.
    let lineRank = indent && para.trim() && !(k === 0 && node.listContinued) ? ++rank : 0;
    let cur = paraStart;
    for (;;) {
      const stop = place(cur, paraStart, paraEnd, lineRank);
      if (stop === null) {
        end = cur;
        break outer;
      }
      lineRank = 0;
      cur = stop;
      if (cur >= paraEnd) break;
    }
    paraStart = paraEnd + 1;
  }
  const lineHeight = style.fontSize * lh;
  const bottom = lines.length ? Math.max(...lines.map((l) => l.top + l.height)) : 0;
  return {
    lines,
    lineHeight,
    width: Math.max(1, region.widest),
    height: Math.max(lineHeight, bottom),
    end: Math.min(end, text.length),
  };
}
