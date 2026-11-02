import {
  activeEffects,
  createAdjustment,
  documentDpi,
  effectMargin,
  masterOf,
  nodeBounds,
  pageFields,
  type Artboard,
  createDocument,
  createGroup,
  createImage,
  fitGroups,
  newId,
  type Adjustment,
  type BlendMode,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { ImageCache, drawArtboard, drawChildren, drawNode } from '@poulpe/render';
import type { Layer, Psd } from 'ag-psd';

/*
 * Fichiers Photoshop (.psd) : ouverture avec leurs calques, et export d'un plan de travail en
 * calques. La lecture et l'écriture du format passent par la bibliothèque ag-psd (licence MIT).
 *
 * À l'ouverture, chaque calque de pixels devient une image (avec son masque, son opacité et son
 * mode de fusion), chaque groupe un groupe, et les calques de réglage courants des réglages
 * Poulpe. Les calques de texte et de forme arrivent en pixels, tels que Photoshop les a dessinés.
 */

const BLEND_FROM_PSD: Partial<Record<string, BlendMode>> = {
  normal: 'normal',
  'pass through': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'color-dodge',
  'linear burn': 'color-burn',
};

const BLEND_TO_PSD: Record<BlendMode, NonNullable<Layer['blendMode']>> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  'hard-light': 'hard light',
  'soft-light': 'soft light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

export function psdBlendMode(mode: BlendMode): NonNullable<Layer['blendMode']> {
  return BLEND_TO_PSD[mode] ?? 'normal';
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Couleur Photoshop → couleur CSS. */
function cssColor(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, number>;
  const h = (n: number) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, '0');
  if ('r' in o) return `#${h(o.r)}${h(o.g)}${h(o.b)}`;
  if ('fr' in o) return `#${h(o.fr * 255)}${h(o.fg * 255)}${h(o.fb * 255)}`;
  if ('k' in o) return `#${h(o.k)}${h(o.k)}${h(o.k)}`;
  return null;
}

/** Calques non importés lors de la dernière lecture (réglages ou effets sans équivalent). */
let skipped: string[] = [];
export const psdSkippedLayers = (): string[] => skipped;

/** Réglage Poulpe équivalent à un calque de réglage Photoshop, quand il existe. */
function adjustmentOf(layer: Layer): Adjustment | null {
  const a = layer.adjustment;
  if (!a) return null;
  switch (a.type) {
    case 'brightness/contrast':
      return {
        kind: 'brightnessContrast',
        brightness: clamp(a.brightness ?? 0, -100, 100),
        contrast: clamp(a.contrast ?? 0, -100, 100),
      };
    case 'levels': {
      const c = a.rgb;
      if (!c) return null;
      return {
        kind: 'levels',
        black: c.shadowInput,
        white: c.highlightInput,
        gamma: clamp(c.midtoneInput || 1, 0.1, 10),
        outBlack: c.shadowOutput,
        outWhite: c.highlightOutput,
      };
    }
    case 'curves': {
      const pts = (ch?: { input: number; output: number }[]): [number, number][] =>
        ch?.length
          ? ch.map((p) => [p.input / 255, p.output / 255])
          : [
              [0, 0],
              [1, 1],
            ];
      return { kind: 'curves', rgb: pts(a.rgb), r: pts(a.red), g: pts(a.green), b: pts(a.blue) };
    }
    case 'exposure':
      return { kind: 'exposure', exposure: a.exposure ?? 0, offset: a.offset ?? 0, gamma: a.gamma ?? 1 };
    case 'vibrance':
      return { kind: 'vibrance', vibrance: a.vibrance ?? 0, saturation: a.saturation ?? 0 };
    case 'hue/saturation':
      return {
        kind: 'hsl',
        hue: a.master?.hue ?? 0,
        saturation: a.master?.saturation ?? 0,
        lightness: a.master?.lightness ?? 0,
      };
    case 'color balance': {
      const v = (c?: {
        cyanRed: number;
        magentaGreen: number;
        yellowBlue: number;
      }): [number, number, number] => [
        clamp(c?.cyanRed ?? 0, -100, 100),
        clamp(c?.magentaGreen ?? 0, -100, 100),
        clamp(c?.yellowBlue ?? 0, -100, 100),
      ];
      return {
        kind: 'colorBalance',
        shadows: v(a.shadows),
        midtones: v(a.midtones),
        highlights: v(a.highlights),
      };
    }
    case 'black & white':
      return {
        kind: 'blackWhite',
        red: clamp(a.reds ?? 40, -200, 300),
        green: clamp(a.greens ?? 40, -200, 300),
        blue: clamp(a.blues ?? 20, -200, 300),
      };
    case 'photo filter':
      return {
        kind: 'photoFilter',
        color: cssColor(a.color) ?? '#ec8a00',
        density: clamp(a.density ?? 25, 0, 100),
      };
    case 'gradient map': {
      const stops = (a.colorStops ?? []).map((st) => ({
        offset: clamp(st.location / 4096, 0, 1),
        color: cssColor(st.color) ?? '#000000',
      }));
      if (stops.length < 2) return null;
      return {
        kind: 'gradientMap',
        stops: a.reverse ? stops.map((st) => ({ ...st, offset: 1 - st.offset })).reverse() : stops,
      };
    }
    case 'invert':
      return { kind: 'invert' };
    case 'posterize':
      return { kind: 'posterize', levels: clamp(a.levels ?? 4, 2, 255) };
    case 'threshold':
      return { kind: 'threshold', level: clamp(a.level ?? 128, 0, 255) };
    default:
      return null;
  }
}

function canvasToAsset(doc: PoulpeDocument, canvas: HTMLCanvasElement): string {
  const id = newId('img');
  doc.assets[id] = {
    id,
    mime: 'image/png',
    width: canvas.width,
    height: canvas.height,
    data: canvas.toDataURL('image/png'),
  };
  return id;
}

/** Masque de calque Photoshop (gris, avec sa propre boîte) → masque Poulpe à la taille du calque. */
function maskAsset(doc: PoulpeDocument, layer: Layer, box: { x: number; y: number; w: number; h: number }) {
  const m = layer.mask;
  if (!m?.canvas || m.fromVectorData) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, box.w);
  canvas.height = Math.max(1, box.h);
  const ctx = canvas.getContext('2d')!;
  const outside = (m.defaultColor ?? 0) / 255;
  ctx.fillStyle = `rgba(0,0,0,${outside})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Le gris du masque devient l'opacité.
  const src = m.canvas.getContext('2d')!.getImageData(0, 0, m.canvas.width, m.canvas.height);
  for (let i = 0; i < src.data.length; i += 4) {
    src.data[i + 3] = src.data[i];
    src.data[i] = src.data[i + 1] = src.data[i + 2] = 0;
  }
  const tmp = document.createElement('canvas');
  tmp.width = src.width;
  tmp.height = src.height;
  tmp.getContext('2d')!.putImageData(src, 0, 0);
  ctx.clearRect((m.left ?? 0) - box.x, (m.top ?? 0) - box.y, tmp.width, tmp.height);
  ctx.drawImage(tmp, (m.left ?? 0) - box.x, (m.top ?? 0) - box.y);
  return { assetId: canvasToAsset(doc, canvas), enabled: !m.disabled };
}

function convertLayers(doc: PoulpeDocument, layers: Layer[], psd: Psd): SceneNode[] {
  const out: SceneNode[] = [];
  for (const layer of layers) {
    const common = {
      name: layer.name || 'Calque',
      opacity: layer.opacity ?? 1,
      visible: !layer.hidden,
      blendMode: BLEND_FROM_PSD[layer.blendMode ?? 'normal'] ?? 'normal',
    };
    if (layer.children) {
      const children = convertLayers(doc, layer.children, psd);
      if (!children.length) continue;
      out.push({ ...createGroup(children, common.name), ...common });
      continue;
    }
    const adj = adjustmentOf(layer);
    if (adj) {
      const node = createAdjustment({ x: 0, y: 0, width: psd.width, height: psd.height, adjustment: adj });
      const mask = maskAsset(doc, layer, { x: 0, y: 0, w: psd.width, h: psd.height });
      out.push({ ...node, ...common, ...(mask ? { mask } : {}) });
      continue;
    }
    const canvas = layer.canvas;
    if (!canvas || !canvas.width || !canvas.height) {
      if (layer.adjustment) skipped.push(common.name);
      continue;
    }
    const x = layer.left ?? 0,
      y = layer.top ?? 0;
    const node = createImage({
      x,
      y,
      width: canvas.width,
      height: canvas.height,
      assetId: canvasToAsset(doc, canvas),
    });
    const mask = maskAsset(doc, layer, { x, y, w: canvas.width, h: canvas.height });
    out.push({ ...node, ...common, ...(mask ? { mask } : {}) });
  }
  return out;
}

/** Document Poulpe à partir des octets d'un fichier .psd. */
export async function psdToDocument(bytes: Uint8Array, name: string): Promise<PoulpeDocument> {
  const { readPsd } = await import('ag-psd');
  skipped = [];
  const psd = readPsd(bytes, { skipThumbnail: true });
  const doc = createDocument({ name, width: psd.width, height: psd.height });
  const ab = doc.artboards[0];
  ab.name = name;
  ab.background = { type: 'none' };
  let children = convertLayers(doc, psd.children ?? [], psd);
  // Fichier sans calques (image aplatie) : on garde l'image composite.
  if (!children.length && psd.canvas) {
    children = [
      createImage({
        x: 0,
        y: 0,
        width: psd.width,
        height: psd.height,
        assetId: canvasToAsset(doc, psd.canvas),
        name: 'Arrière-plan',
      }),
    ];
  }
  ab.children = children;
  fitGroups(doc);
  const dpi = psd.imageResources?.resolutionInfo?.horizontalResolution;
  if (dpi) doc.layout = { dpi: Math.round(dpi) };
  return doc;
}

// ————— Export —————

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function blankCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return [canvas, canvas.getContext('2d')!];
}

/** Calques Photoshop d'une liste d'objets (du dessous vers le dessus), en coordonnées du plan de travail. */
function layersOf(
  doc: PoulpeDocument,
  nodes: SceneNode[],
  ab: Frame,
  frame: Frame,
  images: ImageCache,
  clipBase = false,
): Layer[] {
  const out: Layer[] = [];
  // Les calques de réglage agissent sur tout ce qui est dessous : cette partie devient un seul calque.
  let last = -1;
  nodes.forEach((n, i) => {
    if (n.type === 'adjustment' && n.visible) last = i;
  });
  if (last >= 0) {
    const part = nodes.slice(0, last + 1);
    const [canvas, ctx] = blankCanvas(ab.width, ab.height);
    ctx.translate(-ab.x, -ab.y);
    drawChildren(ctx, doc, part, { images }, frame);
    out.push({ name: part[last].name, left: 0, top: 0, canvas });
  }
  nodes.slice(last + 1).forEach((n, i) => {
    const common: Layer = {
      name: n.name,
      opacity: n.opacity,
      hidden: !n.visible,
      blendMode: psdBlendMode(n.blendMode),
      // Groupe avec masque d'écrêtage : les calques au-dessus du premier sont écrêtés par lui.
      ...(clipBase && i + last + 1 > 0 && n.type !== 'group' ? { clipping: true } : {}),
    };
    if (n.type === 'group') {
      out.push({
        ...common,
        blendMode: n.blendMode === 'normal' ? 'pass through' : common.blendMode,
        opened: true,
        children: layersOf(doc, n.children, ab, nodeBounds(n), images, n.clip),
      });
      return;
    }
    const m = effectMargin(activeEffects(n)) + 2;
    const b = nodeBounds(n);
    // Calque limité au plan de travail, comme une image Photoshop.
    const x0 = Math.max(ab.x, Math.floor(b.x - m)),
      y0 = Math.max(ab.y, Math.floor(b.y - m));
    const x1 = Math.min(ab.x + ab.width, Math.ceil(b.x + b.width + m)),
      y1 = Math.min(ab.y + ab.height, Math.ceil(b.y + b.height + m));
    if (x1 <= x0 || y1 <= y0) return;
    const [canvas, ctx] = blankCanvas(x1 - x0, y1 - y0);
    ctx.translate(-x0, -y0);
    drawNode(ctx, doc, { ...n, visible: true, opacity: 1, blendMode: 'normal' }, { images });
    out.push({ ...common, left: x0 - ab.x, top: y0 - ab.y, canvas });
  });
  return out;
}

/** Fichier .psd d'un plan de travail : un calque par objet, les groupes en groupes de calques. */
export async function artboardToPsd(
  doc: PoulpeDocument,
  ab: Artboard,
  images: ImageCache,
): Promise<Uint8Array> {
  const { writePsd } = await import('ag-psd');
  await images.ready(doc);
  const W = Math.round(ab.width),
    H = Math.round(ab.height);
  const layers: Layer[] = [];
  if (ab.background.type !== 'none') {
    const [canvas, ctx] = blankCanvas(W, H);
    ctx.translate(-ab.x, -ab.y);
    drawArtboard(
      ctx,
      { ...doc, artboards: [{ ...ab, children: [], masterId: undefined }] },
      { ...ab, children: [], masterId: undefined },
      { images },
    );
    layers.push({ name: 'Fond', left: 0, top: 0, canvas });
  }
  const master = masterOf(doc, ab);
  if (master?.children.length) {
    const [canvas, ctx] = blankCanvas(W, H);
    ctx.translate(-master.x, -master.y);
    drawChildren(ctx, doc, master.children, { images, fields: pageFields(doc, ab) }, master);
    layers.push({ name: master.name, left: 0, top: 0, canvas });
  }
  layers.push(...layersOf(doc, ab.children, ab, ab, images));
  const [composite, ctx] = blankCanvas(W, H);
  ctx.translate(-ab.x, -ab.y);
  drawArtboard(ctx, doc, ab, { images });
  const dpi = documentDpi(doc);
  const psd: Psd = {
    width: W,
    height: H,
    canvas: composite,
    children: layers,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: dpi,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches',
      },
    },
  };
  return new Uint8Array(writePsd(psd, { generateThumbnail: true }));
}
