import {
  charX,
  cloneData,
  createGroup,
  createPath,
  exactBounds,
  frameShapeCommands,
  localToWorld,
  layoutTextOnPath,
  pathToSvg,
  type CharStyle,
  type Paint,
  type PathCommand,
  type PathNode,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
} from '@poulpe/core';
import { cachedLayout, measureText, textLayoutIn } from '@poulpe/render';
import type { Font } from 'opentype.js';
import { fontFaceBytes } from './pdfFonts';

/*
 * Vectorisation du texte : chaque caractère est remplacé par le contour de sa lettre, lu dans le
 * fichier de la police (opentype.js). Le résultat est un tracé par couleur, groupés s'il y en a
 * plusieurs.
 */

const fonts = new Map<string, Promise<Font | null>>();

function loadFont(style: CharStyle): Promise<Font | null> {
  const key = `${style.fontFamily}|${style.fontWeight}|${style.italic}`;
  let f = fonts.get(key);
  if (!f) {
    f = (async () => {
      const bytes = await fontFaceBytes({
        family: style.fontFamily,
        weight: style.fontWeight,
        italic: style.italic,
      });
      if (!bytes) return null;
      const { parse } = await import('opentype.js');
      try {
        return parse(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
      } catch {
        return null;
      }
    })();
    fonts.set(key, f);
  }
  return f;
}

/** Contour d'un caractère, posé en (x, y) sur sa ligne de base et tourné de `angle` (radians). */
function glyphCommands(
  font: Font,
  char: string,
  size: number,
  x: number,
  y: number,
  angle = 0,
): PathCommand[] {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const map = (px: number, py: number) => ({ x: x + px * cos - py * sin, y: y + px * sin + py * cos });
  const out: PathCommand[] = [];
  let cx = 0,
    cy = 0;
  for (const c of font.getPath(char, 0, 0, size).commands) {
    if (c.type === 'Z') {
      out.push({ op: 'Z' });
      continue;
    }
    const e = map(c.x!, c.y!);
    if (c.type === 'M' || c.type === 'L') out.push({ op: c.type, ...e });
    else if (c.type === 'C') {
      const a = map(c.x1!, c.y1!),
        b = map(c.x2!, c.y2!);
      out.push({ op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: e.x, y: e.y });
    } else {
      // Courbe quadratique → cubique.
      const q = map(c.x1!, c.y1!);
      const p0 = map(cx, cy);
      out.push({
        op: 'C',
        x1: p0.x + (2 / 3) * (q.x - p0.x),
        y1: p0.y + (2 / 3) * (q.y - p0.y),
        x2: e.x + (2 / 3) * (q.x - e.x),
        y2: e.y + (2 / 3) * (q.y - e.y),
        x: e.x,
        y: e.y,
      });
    }
    cx = c.x!;
    cy = c.y!;
  }
  return out;
}

function rect(x: number, y: number, w: number, h: number): PathCommand[] {
  return [
    { op: 'M', x, y },
    { op: 'L', x: x + w, y },
    { op: 'L', x: x + w, y: y + h },
    { op: 'L', x, y: y + h },
    { op: 'Z' },
  ];
}

/**
 * Contours des lettres d'un texte, dans le repère local du texte, regroupés par couleur.
 * Renvoie la liste des polices introuvables si une police manque.
 */
async function textOutlines(
  node: TextNode,
  doc?: PoulpeDocument,
): Promise<{ parts: { paint: Paint; cmds: PathCommand[] }[]; missing: string[] }> {
  const parts = new Map<string, { paint: Paint; cmds: PathCommand[] }>();
  const missing = new Set<string>();
  const add = (style: CharStyle, cmds: PathCommand[]) => {
    const key = style.color ?? 'fill';
    const paint: Paint = style.color ? { type: 'solid', color: style.color } : node.fill;
    let part = parts.get(key);
    if (!part) parts.set(key, (part = { paint, cmds: [] }));
    part.cmds.push(...cmds);
  };
  if (node.path) {
    for (const g of layoutTextOnPath(node, measureText)) {
      const font = await loadFont(g.style);
      if (!font) {
        missing.add(g.style.fontFamily);
        continue;
      }
      const dx = (-g.width / 2) * Math.cos(g.angle),
        dy = (-g.width / 2) * Math.sin(g.angle);
      add(g.style, glyphCommands(font, g.char, g.style.fontSize, g.x + dx, g.y + dy, g.angle));
    }
  } else {
    // Un cadre de texte prend sa part du texte, avec son alignement vertical.
    const layout = doc ? textLayoutIn(doc, node) : cachedLayout(node, measureText);
    for (const line of layout?.lines ?? []) {
      const mk = line.marker;
      if (mk) {
        const font = await loadFont(mk.style);
        if (font) add(mk.style, glyphCommands(font, mk.text, mk.style.fontSize, mk.x, line.baseline));
        else missing.add(mk.style.fontFamily);
      }
      for (const seg of line.segments) {
        const st = seg.style;
        const font = await loadFont(st);
        if (!font) {
          missing.add(st.fontFamily);
          continue;
        }
        let i = 0;
        for (const ch of seg.text) {
          if (ch.trim())
            add(
              st,
              glyphCommands(font, ch, st.fontSize, charX(line, seg.start + i, measureText), line.baseline),
            );
          i += ch.length;
        }
        if (st.underline || st.strike) {
          const x0 = charX(line, seg.start, measureText),
            x1 = charX(line, seg.end, measureText);
          const th = Math.max(1, st.fontSize / 15);
          if (st.underline) add(st, rect(x0, line.baseline + st.fontSize * 0.1, x1 - x0, th));
          if (st.strike) add(st, rect(x0, line.baseline - st.fontSize * 0.3, x1 - x0, th));
        }
      }
    }
  }
  return { parts: [...parts.values()], missing: [...missing] };
}

/**
 * Objet(s) qui remplacent un texte vectorisé : un tracé (ou un groupe de tracés, un par couleur)
 * à la même place, avec la même rotation, opacité et les mêmes effets.
 */
export async function textToCurves(
  node: TextNode,
  name: string,
  doc?: PoulpeDocument,
): Promise<{ node: SceneNode | null; missing: string[] }> {
  const { parts, missing } = await textOutlines(node, doc);
  if (missing.length) return { node: null, missing };
  const paths: PathNode[] = [];
  for (const part of parts) {
    const b = exactBounds(part.cmds);
    if (!b || !part.cmds.length) continue;
    // Boîte locale du contour, replacée dans le monde avec la rotation du texte.
    const c = localToWorld(node, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const p = createPath({
      x: c.x - b.width / 2,
      y: c.y - b.height / 2,
      width: b.width,
      height: b.height,
      d: pathToSvg(part.cmds),
      viewBox: b,
      name,
    });
    p.rotation = node.rotation;
    p.fill = part.paint;
    p.stroke = cloneData(node.stroke);
    paths.push(p);
  }
  // Cadre de texte en forme (tools/textFlow) : son fond et son contour restent sous les lettres.
  const shape = node.path ? undefined : node.frameShape;
  if (shape && (shape.fill || shape.stroke)) {
    const bg = createPath({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      d: pathToSvg(frameShapeCommands(node)),
      viewBox: { x: 0, y: 0, width: node.width || 1, height: node.height || 1 },
      name,
    });
    bg.rotation = node.rotation;
    bg.fill = shape.fill ? cloneData(shape.fill) : { type: 'none' };
    bg.stroke = cloneData(shape.stroke ?? { ...bg.stroke, paint: { type: 'none' } });
    paths.unshift(bg);
  }
  if (!paths.length) return { node: null, missing: [] };
  const finish = (n: SceneNode) => {
    n.opacity = node.opacity;
    n.blendMode = node.blendMode;
    if (node.effects) n.effects = cloneData(node.effects);
    if (node.transparency) n.transparency = cloneData(node.transparency);
    if (node.wrap) n.wrap = { ...node.wrap };
    return n;
  };
  if (paths.length === 1) return { node: finish(paths[0]), missing: [] };
  return { node: finish(createGroup(paths, name)), missing: [] };
}
