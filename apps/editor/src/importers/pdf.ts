import {
  arrangePages,
  createArtboard,
  createDocument,
  createImage,
  createPath,
  createText,
  newId,
  type Artboard,
  type GradientStop,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
} from '@poulpe/core';

/*
 * Ouverture des fichiers PDF et Illustrator (.ai, enregistrés avec la compatibilité PDF, ce qui est
 * le réglage par défaut d'Illustrator). La lecture passe par pdf.js (licence Apache 2.0) : on
 * parcourt les instructions de dessin de chaque page et on en refait des objets Poulpe
 * modifiables : tracés (remplissage, contour, dégradés), textes et images. Une page devient un
 * plan de travail, à 72 ppp pour qu'un point du PDF fasse un pixel du document.
 *
 * Limites : les masques d'écrêtage sont ignorés (ce qu'ils cachaient réapparaît), les motifs
 * deviennent gris, et une page de plus de 20 000 objets est importée en image.
 */

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** a∘b : applique b, puis a. */
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

interface GState {
  ctm: Matrix;
  fill: Paint;
  stroke: Paint;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dash: number[] | undefined;
  // Texte.
  font: { name: string; bold: boolean; italic: boolean; matrix: number[] } | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  textMatrix: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  renderMode: number;
}

const MAX_NODES = 20000;
const CAPS = ['butt', 'round', 'square'] as const;
const JOINS = ['miter', 'round', 'bevel'] as const;

/** Famille d'une police PDF : « ABCDEF+Montserrat-Bold » → « Montserrat ». */
function familyOf(name: string): string {
  let n = name.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];
  n = n.replace(/(PSMT|PS|MT|Std|Pro)$/, '');
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (/^(Arial|Helvetica)/i.test(n)) return 'Inter';
  return n || 'Inter';
}

/** Dégradé pdf.js (« RadialAxial ») → peinture Poulpe, dans la boîte de l'objet. */
function shadingPaint(ir: unknown[], m: Matrix): Paint | null {
  if (!Array.isArray(ir) || ir[0] !== 'RadialAxial') return null;
  const [, type, , colorStops, p0, p1] = ir as [
    string,
    string,
    unknown,
    [number, string][],
    [number, number],
    [number, number],
    number,
    number,
  ];
  const stops: GradientStop[] = colorStops.map(([offset, color]) => ({ offset, color: String(color) }));
  if (!stops.length) return null;
  if (type === 'axial') {
    const a = apply(m, p0[0], p0[1]),
      b = apply(m, p1[0], p1[1]);
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    return { type: 'linear', angle: Math.round(angle * 10) / 10, stops };
  }
  return { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops };
}

interface PdfjsPage {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(id: string): unknown };
  commonObjs: { get(id: string): unknown };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

async function loadPdfjs() {
  // Version « legacy » : elle complète les fonctions JavaScript récentes qui manquent aux
  // moteurs plus anciens (WebKitGTK de l'appli de bureau sous Linux, par exemple).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function imageAsset(doc: PoulpeDocument, img: unknown): { id: string; w: number; h: number } | null {
  const o = img as {
    width: number;
    height: number;
    bitmap?: ImageBitmap;
    data?: Uint8ClampedArray | Uint8Array;
    kind?: number;
  };
  if (!o?.width || !o?.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d')!;
  if (o.bitmap) ctx.drawImage(o.bitmap, 0, 0);
  else if (o.data) {
    const out = ctx.createImageData(o.width, o.height);
    const d = o.data;
    const n = o.width * o.height;
    if (o.kind === 3) out.data.set(d.subarray(0, n * 4));
    else if (o.kind === 2)
      for (let i = 0; i < n; i++) {
        out.data[i * 4] = d[i * 3];
        out.data[i * 4 + 1] = d[i * 3 + 1];
        out.data[i * 4 + 2] = d[i * 3 + 2];
        out.data[i * 4 + 3] = 255;
      }
    else if (o.kind === 1) {
      const row = (o.width + 7) >> 3;
      for (let y = 0; y < o.height; y++)
        for (let x = 0; x < o.width; x++) {
          const v = d[y * row + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
          const i = (y * o.width + x) * 4;
          out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
          out.data[i + 3] = 255;
        }
    } else return null;
    ctx.putImageData(out, 0, 0);
  } else return null;
  const id = newId('img');
  doc.assets[id] = {
    id,
    mime: 'image/png',
    width: o.width,
    height: o.height,
    data: canvas.toDataURL('image/png'),
  };
  return { id, w: o.width, h: o.height };
}

/** Objets Poulpe d'une page PDF. Renvoie null si la page est trop chargée. */
async function pageNodes(
  doc: PoulpeDocument,
  page: PdfjsPage,
  OPS: Record<string, number>,
  origin: { x: number; y: number },
): Promise<SceneNode[] | null> {
  const viewport = page.getViewport({ scale: 1 });
  const base = mul([1, 0, 0, 1, origin.x, origin.y], viewport.transform as Matrix);
  const { fnArray, argsArray } = await page.getOperatorList();
  const get = (id: string) => (id.startsWith('g_') ? page.commonObjs.get(id) : page.objs.get(id));
  const nodes: SceneNode[] = [];
  let st: GState = {
    ctm: IDENTITY,
    fill: { type: 'solid', color: '#000000' },
    stroke: { type: 'solid', color: '#000000' },
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    cap: 'butt',
    join: 'miter',
    dash: undefined,
    font: null,
    fontSize: 12,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    textMatrix: IDENTITY,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
    renderMode: 0,
  };
  const stack: GState[] = [];
  let lastText: TextNode | null = null;
  let lastTextEnd: [number, number] | null = null;

  const pushPath = (paintOp: number, data: ArrayLike<number>) => {
    const fill = [
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ].includes(paintOp);
    const stroke = [
      OPS.stroke,
      OPS.closeStroke,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ].includes(paintOp);
    if (!fill && !stroke) return;
    const m = mul(base, st.ctm);
    let d = '';
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const pt = (x: number, y: number) => {
      const [X, Y] = apply(m, x, y);
      minX = Math.min(minX, X);
      minY = Math.min(minY, Y);
      maxX = Math.max(maxX, X);
      maxY = Math.max(maxY, Y);
      return `${Math.round(X * 100) / 100} ${Math.round(Y * 100) / 100}`;
    };
    for (let i = 0; i < data.length;) {
      switch (data[i++]) {
        case 0:
          d += `M${pt(data[i++], data[i++])}`;
          break;
        case 1:
          d += `L${pt(data[i++], data[i++])}`;
          break;
        case 2:
          d += `C${pt(data[i++], data[i++])} ${pt(data[i++], data[i++])} ${pt(data[i++], data[i++])}`;
          break;
        case 3:
          d += `Q${pt(data[i++], data[i++])} ${pt(data[i++], data[i++])}`;
          break;
        case 4:
          d += 'Z';
          break;
        default:
          i = data.length;
      }
    }
    if (!d || !Number.isFinite(minX)) return;
    const w = Math.max(maxX - minX, 0.01),
      h = Math.max(maxY - minY, 0.01);
    const node = createPath({
      x: minX,
      y: minY,
      width: w,
      height: h,
      d,
      viewBox: { x: minX, y: minY, width: w, height: h },
      fillRule:
        paintOp === OPS.eoFill || paintOp === OPS.eoFillStroke || paintOp === OPS.closeEOFillStroke
          ? 'evenodd'
          : undefined,
    });
    node.fill = fill ? st.fill : { type: 'none' };
    const k = scaleOf(m);
    node.stroke = stroke
      ? {
          paint: st.stroke,
          width: Math.max(0.1, st.lineWidth * k),
          cap: st.cap,
          join: st.join,
          ...(st.dash?.length ? { dash: st.dash.map((v) => v / Math.max(0.1, st.lineWidth)) } : {}),
        }
      : { paint: { type: 'none' }, width: 1 };
    const alpha = fill ? st.fillAlpha : st.strokeAlpha;
    if (alpha < 1) node.opacity = alpha;
    nodes.push(node);
  };

  const showText = (glyphs: unknown[]) => {
    const font = st.font;
    if (!font || !st.fontSize) return;
    const fm = font.matrix[0] || 0.001;
    let text = '';
    const startX = st.x;
    for (const g of glyphs) {
      if (typeof g === 'number') {
        const shift = -g * st.fontSize * 0.001 * st.hScale;
        // Un grand recul entre deux mots marque une espace.
        if (g < -200 && text && !text.endsWith(' ')) text += ' ';
        st.x += shift;
        continue;
      }
      const glyph = g as { unicode?: string; width?: number; isSpace?: boolean } | null;
      if (!glyph) continue;
      text += glyph.unicode ?? '';
      st.x +=
        ((glyph.width ?? 0) * st.fontSize * fm + st.charSpacing + (glyph.isSpace ? st.wordSpacing : 0)) *
        st.hScale;
    }
    if (!text.trim() || st.renderMode === 3 || st.renderMode === 7) return;
    const m = mul(mul(base, st.ctm), st.textMatrix);
    const [x0, y0] = apply(m, startX, st.y + st.rise);
    const [x1, y1] = apply(m, st.x, st.y + st.rise);
    const k = Math.hypot(m[2], m[3]);
    const size = st.fontSize * k;
    if (size < 0.5) return;
    const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const width = Math.hypot(x1 - x0, y1 - y0);
    const color = st.fill.type === 'solid' ? st.fill.color : '#000000';
    const family = familyOf(font.name);
    const weight = font.bold ? 700 : 400;
    // Suite d'un texte sur la même ligne, dans le même style : on l'ajoute au précédent.
    if (
      lastText &&
      lastTextEnd &&
      Math.abs(angle) < 0.5 &&
      lastText.rotation === 0 &&
      Math.abs(lastText.style.fontSize - size) < 0.1 &&
      lastText.style.fontFamily === family &&
      lastText.style.fontWeight === weight &&
      lastText.style.italic === font.italic &&
      lastText.fill.type === 'solid' &&
      lastText.fill.color === color &&
      Math.abs(lastTextEnd[1] - y0) < size * 0.1 &&
      x0 - lastTextEnd[0] > -size * 0.3 &&
      x0 - lastTextEnd[0] < size * 1.5
    ) {
      const gap = x0 - lastTextEnd[0];
      lastText.text +=
        (gap > size * 0.15 && !lastText.text.endsWith(' ') && !text.startsWith(' ') ? ' ' : '') + text;
      lastText.width = Math.max(lastText.width, x1 - lastText.x);
      lastTextEnd = [x1, y1];
      return;
    }
    const node = createText({
      x: x0,
      y: y0 - size * 0.9,
      width: Math.max(width, 1),
      height: size * 1.2,
      text,
      autoWidth: true,
    });
    node.style = {
      ...node.style,
      fontFamily: family,
      fontSize: Math.round(size * 100) / 100,
      fontWeight: weight,
      italic: font.italic,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'left',
    };
    node.fill = { type: 'solid', color };
    if (Math.abs(angle) >= 0.5) {
      // Rotation autour du centre : on recentre la boîte sur le milieu de la ligne.
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      const nx = -Math.sin((angle * Math.PI) / 180),
        ny = Math.cos((angle * Math.PI) / 180);
      node.rotation = angle;
      node.x = cx - node.width / 2 - nx * size * 0.3;
      node.y = cy - node.height / 2 - ny * size * 0.3;
    }
    if (st.fillAlpha < 1) node.opacity = st.fillAlpha;
    nodes.push(node);
    lastText = node;
    lastTextEnd = [x1, y1];
  };

  const placeImage = (img: unknown) => {
    const a = imageAsset(doc, img);
    if (!a) return;
    const m = mul(base, st.ctm);
    // L'image occupe le carré unité de son repère, rangée du haut en y = 1.
    const [cx, cy] = apply(m, 0.5, 0.5);
    const w = Math.hypot(m[0], m[1]),
      h = Math.hypot(m[2], m[3]);
    const node = createImage({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, assetId: a.id });
    const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    if (Math.abs(angle) > 0.01) node.rotation = angle;
    if (st.fillAlpha < 1) node.opacity = st.fillAlpha;
    nodes.push(node);
  };

  for (let i = 0; i < fnArray.length; i++) {
    if (nodes.length > MAX_NODES) return null;
    const fn = fnArray[i];
    const args = argsArray[i] ?? [];
    switch (fn) {
      case OPS.save:
      case OPS.paintFormXObjectBegin:
        stack.push({ ...st });
        if (fn === OPS.paintFormXObjectBegin && Array.isArray(args[0]))
          st.ctm = mul(st.ctm, args[0] as Matrix);
        break;
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
        st = stack.pop() ?? st;
        break;
      case OPS.transform:
        st.ctm = mul(st.ctm, args as Matrix);
        break;
      case OPS.setFillRGBColor:
        st.fill = { type: 'solid', color: String(args[0]) };
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = { type: 'solid', color: String(args[0]) };
        break;
      case OPS.setFillTransparent:
        st.fill = { type: 'none' };
        break;
      case OPS.setStrokeTransparent:
        st.stroke = { type: 'none' };
        break;
      case OPS.setFillColorN:
      case OPS.setStrokeColorN: {
        let paint: Paint = { type: 'solid', color: '#808080' };
        if (args[0] === 'Shading' && typeof args[1] === 'string') {
          const ir = get(args[1]) as unknown[];
          paint = shadingPaint(ir, mul(base, st.ctm)) ?? paint;
        }
        if (fn === OPS.setFillColorN) st.fill = paint;
        else st.stroke = paint;
        break;
      }
      case OPS.setLineWidth:
        st.lineWidth = Number(args[0]);
        break;
      case OPS.setLineCap:
        st.cap = CAPS[Number(args[0])] ?? 'butt';
        break;
      case OPS.setLineJoin:
        st.join = JOINS[Number(args[0])] ?? 'miter';
        break;
      case OPS.setDash:
        st.dash = (args[0] as number[]) ?? undefined;
        break;
      case OPS.setGState:
        for (const [key, value] of (args[0] as [string, unknown][]) ?? []) {
          if (key === 'LW') st.lineWidth = Number(value);
          else if (key === 'LC') st.cap = CAPS[Number(value)] ?? 'butt';
          else if (key === 'LJ') st.join = JOINS[Number(value)] ?? 'miter';
          else if (key === 'D') st.dash = (value as [number[], number])[0];
          else if (key === 'CA') st.strokeAlpha = Number(value);
          else if (key === 'ca') st.fillAlpha = Number(value);
        }
        break;
      case OPS.constructPath: {
        const [paintOp, data] = args as [number, (ArrayLike<number> | null)[]];
        if (data?.[0]) pushPath(paintOp, data[0]);
        break;
      }
      case OPS.beginText:
        st.textMatrix = IDENTITY;
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      case OPS.setFont: {
        const f = get(String(args[0])) as {
          name?: string;
          bold?: boolean;
          black?: boolean;
          italic?: boolean;
          fontMatrix?: number[];
        } | null;
        st.font = f
          ? {
              name: f.name ?? 'Inter',
              bold: !!(f.bold || f.black) || /bold|black|heavy/i.test(f.name ?? ''),
              italic: !!f.italic || /italic|oblique/i.test(f.name ?? ''),
              matrix: f.fontMatrix ?? [0.001],
            }
          : null;
        st.fontSize = Math.abs(Number(args[1]));
        break;
      }
      case OPS.setCharSpacing:
        st.charSpacing = Number(args[0]);
        break;
      case OPS.setWordSpacing:
        st.wordSpacing = Number(args[0]);
        break;
      case OPS.setHScale:
        st.hScale = Number(args[0]) / 100;
        break;
      case OPS.setLeading:
        st.leading = -Number(args[0]);
        break;
      case OPS.setTextRise:
        st.rise = Number(args[0]);
        break;
      case OPS.setTextRenderingMode:
        st.renderMode = Number(args[0]);
        break;
      case OPS.setTextMatrix:
        st.textMatrix = (Array.isArray(args[0]) ? args[0] : args) as Matrix;
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      case OPS.moveText:
        st.x = st.lineX += Number(args[0]);
        st.y = st.lineY += Number(args[1]);
        break;
      case OPS.setLeadingMoveText:
        st.leading = Number(args[1]);
        st.x = st.lineX += Number(args[0]);
        st.y = st.lineY += Number(args[1]);
        break;
      case OPS.nextLine:
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        showText((args[0] as unknown[]) ?? []);
        break;
      case OPS.nextLineShowText:
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        showText((args[0] as unknown[]) ?? []);
        break;
      case OPS.paintImageXObject:
        try {
          placeImage(get(String(args[0])));
        } catch {
          // Image pas encore décodée : ignorée.
        }
        break;
      case OPS.paintInlineImageXObject:
        placeImage(args[0]);
        break;
    }
  }
  return nodes;
}

/** Image d'une page, quand elle est trop complexe pour être importée en objets. */
async function pageAsImage(doc: PoulpeDocument, page: PdfjsPage, ab: Artboard): Promise<SceneNode> {
  const scale = 300 / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  const id = newId('img');
  doc.assets[id] = {
    id,
    mime: 'image/png',
    width: canvas.width,
    height: canvas.height,
    data: canvas.toDataURL('image/png'),
  };
  return createImage({ x: ab.x, y: ab.y, width: ab.width, height: ab.height, assetId: id, name: ab.name });
}

export interface PdfImport {
  doc: PoulpeDocument;
  /** Pages importées en image (trop d'objets ou erreur). */
  rasterPages: number;
}

/** Document Poulpe à partir des octets d'un fichier PDF ou AI. */
export async function pdfToDocument(bytes: Uint8Array, name: string, maxPages = 100): Promise<PdfImport> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  const doc = createDocument({ name, width: 10, height: 10 });
  doc.artboards = [];
  doc.layout = { dpi: 72 };
  let rasterPages = 0;
  const count = Math.min(pdf.numPages, maxPages);
  for (let n = 1; n <= count; n++) {
    const page = (await pdf.getPage(n)) as unknown as PdfjsPage;
    const vp = page.getViewport({ scale: 1 });
    const ab = createArtboard({
      x: 0,
      y: 0,
      width: Math.round(vp.width * 100) / 100,
      height: Math.round(vp.height * 100) / 100,
      name: count > 1 ? `Page ${n}` : name,
    });
    doc.artboards.push(ab);
    let nodes: SceneNode[] | null;
    try {
      nodes = await pageNodes(doc, page, OPS, ab);
    } catch (e) {
      console.warn('Page importée en image :', e);
      nodes = null;
    }
    if (!nodes) {
      rasterPages++;
      nodes = [await pageAsImage(doc, page, ab)];
    }
    ab.children = nodes;
  }
  await task.destroy();
  if (doc.artboards.length > 1) arrangePages(doc);
  return { doc, rasterPages };
}
