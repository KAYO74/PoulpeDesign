// Construit le paquet « Pinceaux libres » (apps/editor/src/tools/brushes/freePack.json) à partir des
// pinceaux MyPaint, publiés en domaine public (CC0 1.0) : https://github.com/mypaint/mypaint-brushes
//
// Usage : node scripts/build-mypaint-pack.mjs <dossier brushes de mypaint-brushes>
//
// Seuls les réglages sont repris (taille, dureté, flux, espacement, hasard, forme étirée) : le moteur
// de Poulpe Design est à touches (une forme répétée le long du tracé), il n'a pas de mélange de
// couleurs. Les pinceaux qui salissent ou effacent (smudge, eraser) sont laissés de côté. Les formes
// de grain, craie, crayon, poils, éclaboussure et feuille sont dessinées ici (aucune image reprise).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = process.argv[2];
if (!root) {
  console.error('Usage : node scripts/build-mypaint-pack.mjs <dossier brushes de mypaint-brushes>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '../apps/editor/src/tools/brushes/freePack.json');

/** Auteurs (domaine public / CC0, voir Licenses.dep5 de mypaint-brushes). */
const AUTHORS = {
  deevad: 'David Revoy',
  ramon: 'Ramón Miranda',
  tanda: 'Tanda',
  kaerhon_v1: 'Kaerhon',
  classic: 'MyPaint',
  experimental: 'MyPaint',
};
const SKIP = new Set(['pick_and_drag', 'track', 'DNA_brush', 'sewing', 'particules_eraser']);

// --- PNG sans bibliothèque (niveaux de gris + opacité) ------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** PNG noir dont l'opacité est `alpha` (w × h octets). */
function png(w, h, alpha) {
  const raw = Buffer.alloc((w * 2 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      raw[y * (w * 2 + 1) + 1 + x * 2] = 0;
      raw[y * (w * 2 + 1) + 1 + x * 2 + 1] = alpha[y * w + x];
    }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 4; // niveaux de gris + opacité
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Formes dessinées ---------------------------------------------------------------------------
let seed = 20261105;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
const S = 96;
const hash = (i, j, k) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const smooth = (t) => t * t * (3 - 2 * t);
/** Bruit de valeurs lissé. */
function noise(x, y, cell, k) {
  const gx = x / cell,
    gy = y / cell,
    i = Math.floor(gx),
    j = Math.floor(gy);
  const fx = smooth(gx - i),
    fy = smooth(gy - j);
  return (
    hash(i, j, k) * (1 - fx) * (1 - fy) +
    hash(i + 1, j, k) * fx * (1 - fy) +
    hash(i, j + 1, k) * (1 - fx) * fy +
    hash(i + 1, j + 1, k) * fx * fy
  );
}
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** Disque de bord adouci, de rayon `r` (part de la demi-taille). */
const disc = (x, y, r, soft) => {
  const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
  return Math.max(0, Math.min(1, (r - d) / soft));
};
function shape(fn) {
  const a = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) a[y * S + x] = clamp8(fn(x, y) * 255);
  return a;
}
const TIPS = {
  // Grain de fusain : disque parsemé de points.
  grain: shape((x, y) => disc(x, y, 0.95, 0.25) * Math.max(0, noise(x, y, 2.2, 1) * 1.5 - 0.45)),
  // Craie : bord irrégulier, trous.
  chalk: shape(
    (x, y) =>
      disc(x, y, 0.9 + (noise(x, y, 6, 2) - 0.5) * 0.3, 0.2) * Math.max(0, noise(x, y, 1.6, 3) * 1.8 - 0.55),
  ),
  // Crayon : petit grain fin, bord doux.
  pencil: shape((x, y) => disc(x, y, 0.95, 0.5) * (0.55 + 0.45 * noise(x, y, 1.4, 4))),
  // Poils : stries.
  bristle: shape((x, y) => {
    const streak = noise(x, y * 0.12, 2.4, 5);
    return disc(x, y, 0.95, 0.12) * Math.max(0, streak * 1.5 - 0.3);
  }),
  // Éclaboussure : tache irrégulière et gouttes.
  splat: (() => {
    const a = new Uint8Array(S * S);
    const drops = [[0, 0, 0.5]];
    for (let i = 0; i < 9; i++) {
      const ang = rnd() * Math.PI * 2,
        d = 0.35 + rnd() * 0.5;
      drops.push([Math.cos(ang) * d, Math.sin(ang) * d, 0.05 + rnd() * 0.13]);
    }
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const px = (x - S / 2 + 0.5) / (S / 2),
          py = (y - S / 2 + 0.5) / (S / 2);
        let v = 0;
        for (const [cx, cy, r] of drops) v = Math.max(v, (r - Math.hypot(px - cx, py - cy)) / 0.06);
        const wobble = 1 + (noise(x, y, 7, 6) - 0.5) * 0.5;
        a[y * S + x] = clamp8(Math.max(0, Math.min(1, v * wobble)) * 255);
      }
    return a;
  })(),
  // Feuille : ellipse pointue avec une nervure.
  leaf: shape((x, y) => {
    const px = (x - S / 2 + 0.5) / (S / 2),
      py = (y - S / 2 + 0.5) / (S / 2);
    const half = 0.55 * Math.max(0, 1 - Math.abs(px) ** 1.6);
    const edge = Math.max(0, Math.min(1, (half - Math.abs(py)) / 0.06));
    return edge * (Math.abs(py) < 0.015 ? 0.55 : 1);
  }),
};
const TIP_NAMES = {
  grain: 'Grain',
  chalk: 'Craie',
  pencil: 'Crayon',
  bristle: 'Poils',
  splat: 'Éclaboussure',
  leaf: 'Feuille',
};
const tips = Object.entries(TIPS).map(([key, alpha]) => ({
  id: `tip-${key}`,
  name: TIP_NAMES[key],
  data: `data:image/png;base64,${png(S, S, alpha).toString('base64')}`,
  w: S,
  h: S,
}));

/** Forme qui évoque le mieux le pinceau, d'après son nom. */
function tipFor(name) {
  const n = name.toLowerCase();
  if (/leaves/.test(n)) return 'leaf';
  if (/splatter|blot|particul|bubble|spray|splash/.test(n)) return 'splat';
  if (/chalk|pastel|charcoal|dirty|grain|dry|rough|texture|hard_sting/.test(n))
    return /dry|rough/.test(n) ? 'bristle' : n.includes('charcoal') ? 'grain' : 'chalk';
  if (/pencil|sketch|b-pencil|hb/.test(n)) return 'pencil';
  if (/fur|grass|bristle|oil|acrylic|bulk|paint_barrr|coarse/.test(n)) return 'bristle';
  return undefined;
}

// --- Conversion .myb → préréglage ---------------------------------------------------------------
/** Courbe par morceaux : valeur de l'entrée à x. */
function curve(points, x) {
  if (!points?.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return points.at(-1)[1];
}
/** Valeur d'un réglage à pleine pression (un stylet appuyé, ou la souris dans Poulpe Design). */
function value(settings, key, fallback = 0) {
  const s = settings[key];
  if (!s) return fallback;
  return s.base_value + curve(s.inputs?.pressure, 1);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const title = (s) =>
  s
    .replace(/[_+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

const presets = [];
for (const group of readdirSync(root).sort()) {
  if (!AUTHORS[group]) continue;
  for (const file of readdirSync(join(root, group)).sort()) {
    if (!file.endsWith('.myb')) continue;
    const base = file.replace(/\.myb$/, '');
    if (SKIP.has(base)) continue;
    const j = JSON.parse(readFileSync(join(root, group, file), 'utf8'));
    const s = j.settings;
    if (value(s, 'smudge') > 0.3 || value(s, 'eraser') >= 0.5) continue;
    const size = clamp(Math.round(2 * Math.exp(value(s, 'radius_logarithmic', 2))), 1, 1000);
    // Opacité de la touche : « opaque » × « opaque_multiply » (courbes de pression), bornée.
    const opaque = clamp(
      value(s, 'opaque', 1) * (s.opaque_multiply ? value(s, 'opaque_multiply', 1) : 1),
      0,
      1,
    );
    const flow = clamp(Math.round(opaque * 100), 3, 100);
    const hardness = clamp(Math.round(value(s, 'hardness', 0.8) * 100), 0, 100);
    const dabs = Math.max(value(s, 'dabs_per_basic_radius'), value(s, 'dabs_per_actual_radius'), 1);
    const spacing = clamp(Math.round(50 / dabs), 1, 100);
    const preset = {
      id: `${group}-${base}`,
      name: `${AUTHORS[group]} · ${title(base)}`,
      size,
      hardness,
      opacity: 100,
      flow,
      spacing,
    };
    const tip = tipFor(base);
    if (tip) preset.tip = `tip-${tip}`;
    const rr = value(s, 'radius_by_random');
    if (rr > 0.05) preset.sizeJitter = clamp(Math.round((Math.exp(rr) - 1) * 100), 1, 100);
    const off = value(s, 'offset_by_random');
    if (off > 0.2) preset.scatter = clamp(Math.round(off * 50), 1, 200);
    const ratio = value(s, 'elliptical_dab_ratio', 1);
    if (ratio > 1.2) {
      preset.roundness = clamp(Math.round(100 / ratio), 5, 100);
      preset.angle = Math.round(value(s, 'elliptical_dab_angle', 90)) % 180;
    }
    presets.push(preset);
  }
}

const used = new Set(presets.map((p) => p.tip).filter(Boolean));
const pack = {
  format: 'poulpe-brushes',
  version: 1,
  name: 'Pinceaux libres (MyPaint, CC0)',
  author: 'David Revoy, Ramón Miranda, Tanda, Kaerhon, équipe MyPaint',
  license: 'CC0 1.0 (domaine public) : https://github.com/mypaint/mypaint-brushes',
  presets,
  tips: tips.filter((t) => used.has(t.id)),
};
writeFileSync(out, JSON.stringify(pack));
console.log(`${presets.length} pinceaux, ${pack.tips.length} formes → ${out}`);
