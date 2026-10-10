import {
  POULPE_EXTENSION,
  PoulpeFileError,
  arrangePages,
  insertPage,
  masterOf,
  printablePages,
  preparePrintPdf,
  pxToPt,
  activeEffects,
  artboardToSvg,
  bytesToDataUrl,
  effectMargin,
  nodeBounds,
  type SceneNode,
  createDocument,
  type Artboard,
  type PoulpeDocument,
} from '@poulpe/core';
import {
  ImageCache,
  drawChildren,
  drawNode,
  materialize,
  measureText,
  rasterizeArtboard,
} from '@poulpe/render';
import { placeImage } from './actions';
import { decodeFile, encodeFile } from './fileWorker';
import { t } from './i18n';
import { editor, toast, ui } from './store';
import { placeSvg } from './vectorActions';

/*
 * Entrées / sorties de fichiers. Dans l'appli de bureau (Tauri), on passe par les boîtes de
 * dialogue et le système de fichiers natifs ; dans le navigateur, par l'API File System Access
 * quand elle existe, sinon par un téléchargement.
 */

export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const exportImages = new ImageCache();

export type FileKind =
  'poulpe' | 'png' | 'jpeg' | 'svg' | 'pdf' | 'psd' | 'zip' | 'macro' | 'extension' | 'prefs';
const KINDS: Record<FileKind, { ext: string; mime: string; label: string }> = {
  poulpe: { ext: POULPE_EXTENSION, mime: 'application/x-poulpe', label: 'Poulpe Design' },
  png: { ext: 'png', mime: 'image/png', label: 'PNG' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
  svg: { ext: 'svg', mime: 'image/svg+xml', label: 'SVG' },
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' },
  psd: { ext: 'psd', mime: 'image/vnd.adobe.photoshop', label: 'Photoshop' },
  zip: { ext: 'zip', mime: 'application/zip', label: 'ZIP' },
  macro: { ext: 'poulpemacro', mime: 'application/json', label: 'Macro Poulpe Design' },
  extension: { ext: 'js', mime: 'text/javascript', label: 'Extension Poulpe Design' },
  prefs: { ext: 'poulpeprefs', mime: 'application/json', label: 'Préférences Poulpe Design' },
};

/** Formats que « Ouvrir » sait lire, en plus des documents Poulpe Design. */
export const OPEN_EXTENSIONS = [POULPE_EXTENSION, 'psd', 'pdf', 'ai'];

export function baseName(path: string): string {
  return path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '');
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'poulpe';
}

/** Enregistre des octets sous un nom choisi par l'utilisateur. Renvoie le chemin ou le nom, ou null si annulé. */
export async function saveBytes(
  bytes: Uint8Array,
  kind: FileKind,
  suggested: string,
  existingPath?: string | null,
): Promise<string | null> {
  const info = KINDS[kind];
  const fileName = `${safeName(suggested)}.${info.ext}`;
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path =
      existingPath ??
      (await save({ defaultPath: fileName, filters: [{ name: info.label, extensions: [info.ext] }] }));
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: info.label, accept: { [info.mime]: [`.${info.ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as BufferSource);
      await writable.close();
      return handle.name;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      // Sinon on se rabat sur le téléchargement.
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: info.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}

export async function pickFile(
  accept: string[],
  mimes: string,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (isDesktop()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: accept.join(', '), extensions: accept }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path, bytes: await readFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mimes;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.click();
  });
}

export function confirmDiscard(): boolean {
  return !editor.getState().dirty || window.confirm(t('file.unsaved'));
}

export function newDocument(
  width: number,
  height: number,
  opts: { dpi?: number; pages?: number; facing?: boolean } = {},
): void {
  if (!confirmDiscard()) return;
  const doc = createDocument({ name: t('app.untitled'), width, height });
  const pages = Math.max(1, Math.round(opts.pages ?? 1));
  if (opts.dpi || opts.facing || pages > 1) {
    doc.layout = {};
    if (opts.dpi) doc.layout.dpi = opts.dpi;
    if (opts.facing) doc.layout.facing = true;
    doc.artboards[0].name = t('pages.pageName', { n: 1 });
    for (let i = 2; i <= pages; i++) insertPage(doc, { name: t('pages.pageName', { n: i }) });
    arrangePages(doc);
  }
  editor.load(doc);
  // Un document de plusieurs pages s'ouvre dans la Persona Mise en page.
  ui.set({ filePath: null, dialog: null, ...(pages > 1 ? { persona: 'layout' as const } : {}) });
  requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
}

export async function loadBytes(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const doc = await decodeFile(bytes);
    editor.load({ ...doc, name: baseName(name) });
    ui.set({ filePath: name, dialog: null });
    requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
  } catch (e) {
    window.alert(e instanceof PoulpeFileError && e.code === 'tooNew' ? t('file.tooNew') : t('file.invalid'));
  }
}

export async function openDocument(): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await pickFile(OPEN_EXTENSIONS, OPEN_EXTENSIONS.map((e) => `.${e}`).join(','));
  if (file) await openBytes(file.name, file.bytes);
}

/** Ouvre un document Poulpe Design, Photoshop, PDF ou Illustrator d'après son extension. */
export async function openBytes(name: string, bytes: Uint8Array): Promise<void> {
  const ext = name.split('.').pop()!.toLowerCase();
  if (ext !== 'psd' && ext !== 'pdf' && ext !== 'ai') return loadBytes(name, bytes);
  toast(t('file.opening'));
  try {
    if (ext === 'psd') {
      const { psdToDocument } = await import('./importers/psd');
      const doc = await psdToDocument(bytes, baseName(name));
      editor.load(doc, { unsaved: true });
      ui.set({ filePath: null, dialog: null, persona: 'photo', tool: 'select', maskEditId: null });
    } else {
      // Un fichier Illustrator se lit par sa partie PDF (« Créer un fichier compatible PDF »).
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
      if (!head.includes('%PDF')) {
        window.alert(t(ext === 'ai' ? 'file.aiNoPdf' : 'file.invalid'));
        return;
      }
      const { pdfToDocument } = await import('./importers/pdf');
      const { doc, rasterPages } = await pdfToDocument(bytes, baseName(name));
      editor.load(doc, { unsaved: true });
      ui.set({
        filePath: null,
        dialog: null,
        persona: doc.artboards.length > 1 ? 'layout' : 'draw',
        tool: 'select',
      });
      toast(rasterPages ? t('file.pdfRasterPages', { n: rasterPages }) : t('file.pdfOpened'));
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
  } catch (e) {
    console.error(e);
    window.alert(t('file.importError'));
  }
}

/** Ouvre un fichier par son chemin (double-clic sur un `.poulpe` dans l'appli de bureau). */
export async function openPath(path: string): Promise<void> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  await openBytes(path, await readFile(path));
}

async function thumbnail(doc: PoulpeDocument): Promise<Uint8Array | undefined> {
  const ab = doc.artboards[0];
  if (!ab) return undefined;
  try {
    const blob = await rasterizeArtboard(doc, ab, exportImages, {
      scale: Math.min(1, 256 / Math.max(ab.width, ab.height)),
    });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return undefined;
  }
}

export async function saveDocument(saveAs = false): Promise<void> {
  const live = editor.doc;
  const doc = await materialize(live);
  const bytes = await encodeFile(doc, {
    thumbnail: await thumbnail(live),
    generator: `Poulpe Design ${__APP_VERSION__}`,
  });
  // Dans le navigateur, on ne peut pas réécrire le fichier ouvert : chaque enregistrement redemande où l'écrire.
  const existing = !saveAs && isDesktop() ? ui.get().filePath : null;
  const path = await saveBytes(bytes, 'poulpe', doc.name, existing);
  if (!path) return;
  // Marque enregistré le document tel qu'il était au moment de l'enregistrement.
  if (editor.doc === live) editor.markSaved();
  ui.set({ filePath: path });
  toast(t('file.saved'));
}

export async function importImage(): Promise<void> {
  const file = await pickFile(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], 'image/*');
  if (!file) {
    ui.set({ tool: 'select' });
    return;
  }
  const ext = file.name.split('.').pop()!.toLowerCase();
  if (ext === 'svg') {
    // Un SVG arrive en objets modifiables ; s'il est illisible, en image.
    if (placeSvg(new TextDecoder().decode(file.bytes), baseName(file.name))) return;
  }
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  await placeImageBytes(file.bytes, mime);
}

/** Ouvre une photo dans un nouveau document à sa taille, en Persona Photo (comme Affinity Photo). */
export async function openPhoto(): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await pickFile(
    ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    'image/png,image/jpeg,image/webp,image/gif',
  );
  if (!file) return;
  const ext = file.name.split('.').pop()!.toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  await openPhotoBytes(file.bytes, mime, baseName(file.name));
}

export async function openPhotoBytes(bytes: Uint8Array, mime: string, name: string): Promise<void> {
  const data = bytesToDataUrl(bytes, mime);
  const img = new Image();
  img.src = data;
  try {
    await img.decode();
  } catch {
    window.alert(t('file.imageError'));
    return;
  }
  const { openPhotoDocument } = await import('./photo/photoActions');
  openPhotoDocument(data, mime, img.naturalWidth || 512, img.naturalHeight || 512, name);
}

export async function placeImageBytes(
  bytes: Uint8Array,
  mime: string,
  at?: { x: number; y: number },
): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const data = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
  const img = new Image();
  img.src = data;
  try {
    await img.decode();
  } catch {
    window.alert(t('file.imageError'));
    return;
  }
  placeImage(data, mime, img.naturalWidth || 512, img.naturalHeight || 512, at);
}

export type ExportKind = 'png' | 'jpeg' | 'svg' | 'pdf' | 'psd';

export interface ExportOptions {
  kind: ExportKind;
  /**
   * `all` : toutes les pages (PDF multipage ; un fichier par page sinon, sans les pages maîtres).
   * `range` : les pages données par `pages` (PDF).
   */
  artboardId: string | 'all' | 'range';
  scale: number;
  quality: number;
  transparent: boolean;
  /** Plage de pages, par ex. « 1-3, 5 » (avec `artboardId: 'range'`). */
  pages?: string;
  /** PDF : ajouter le fond perdu du document autour de chaque page. */
  bleed?: boolean;
  /** PDF : traits de coupe aux coins des pages. */
  marks?: boolean;
  /** PDF : couleurs RVB (écran) ou CMJN (impression). */
  color?: 'rgb' | 'cmyk';
  /** PDF : norme PDF/X-4 pour l'imprimeur (implique le CMJN). */
  pdfx?: boolean;
}

/** Pages d'une plage « 1-3, 5 » (numéros à partir de 1), dans l'ordre du document. */
export function parsePageRange(range: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of range.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === '' ? count : Number(m[2]);
    for (let i = Math.max(1, Math.min(a, b)); i <= Math.min(count, Math.max(a, b)); i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

/** Image PNG (balise SVG) d'une zone du document rendue sur un canevas. */
function rasterImage(
  box: { x: number; y: number; width: number; height: number },
  scale: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.width * scale));
  canvas.height = Math.max(1, Math.ceil(box.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  draw(ctx);
  return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="none" href="${canvas.toDataURL('image/png')}"/>`;
}

/** Pixels de l'image par pixel du document, au plus fin parmi les images des objets. */
function imageDensity(doc: PoulpeDocument, nodes: SceneNode[]): number {
  let d = 1;
  const visit = (n: SceneNode) => {
    if (n.type === 'group') n.children.forEach(visit);
    else if (n.type === 'image') {
      const a = doc.assets[n.assetId];
      if (a) d = Math.max(d, (a.width * (n.crop?.width ?? 1)) / Math.max(1, n.width));
    }
  };
  nodes.forEach(visit);
  return d;
}

/**
 * Ce que le SVG ou le PDF ne savent pas décrire est mis en image :
 * - les calques de réglage, avec tout ce qu'ils modifient (les calques du dessous dans leur parent) ;
 * - pour le PDF (`pdf`), les objets qui ont des effets ou un masque.
 */
async function rasterizedParts(
  doc: PoulpeDocument,
  ab: Artboard,
  pdf: boolean,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const visitChildren = async (
    nodes: SceneNode[],
    frame: { x: number; y: number; width: number; height: number },
  ) => {
    let last = -1;
    nodes.forEach((n, i) => {
      if (n.type === 'adjustment' && n.visible) last = i;
    });
    if (last >= 0) {
      const part = nodes.slice(0, last + 1);
      const host = part.find((n) => n.visible);
      if (host) {
        const scale = Math.min(
          4096 / Math.max(frame.width, frame.height, 1),
          Math.max(2, imageDensity(doc, part)),
        );
        out.set(
          host.id,
          rasterImage(frame, scale, (ctx) => drawChildren(ctx, doc, part, { images: exportImages }, frame)),
        );
        for (const n of part) if (n !== host) out.set(n.id, '');
      }
    }
    for (const n of nodes.slice(last + 1)) await visit(n);
  };
  const visit = async (n: SceneNode) => {
    if (!n.visible) return;
    const fx = activeEffects(n);
    if (!pdf || (!fx.length && !n.mask?.enabled)) {
      if (n.type === 'group') await visitChildren(n.children, nodeBounds(n));
      return;
    }
    const m = effectMargin(fx) + 2;
    const b = nodeBounds(n);
    const x = b.x - m,
      y = b.y - m,
      w = b.width + 2 * m,
      h = b.height + 2 * m;
    const scale = Math.min(2, 4096 / Math.max(w, h, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
    drawNode(ctx, doc, n, { images: exportImages });
    out.set(
      n.id,
      `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" href="${canvas.toDataURL('image/png')}"/>`,
    );
  };
  await exportImages.ready(doc);
  await visitChildren(ab.children, { x: ab.x, y: ab.y, width: ab.width, height: ab.height });
  // Les objets de la page maître restent à leur place sur la page maître (le SVG les décale).
  const master = masterOf(doc, ab);
  if (master)
    await visitChildren(master.children, {
      x: master.x,
      y: master.y,
      width: master.width,
      height: master.height,
    });
  return out;
}

/**
 * PDF à la taille réelle des pages (d'après la résolution du document), avec fond perdu et traits
 * de coupe si demandé. Les boîtes TrimBox et BleedBox indiquent à l'imprimeur où couper.
 */
async function svgToPdf(
  doc: PoulpeDocument,
  artboards: Artboard[],
  opts: { bleed?: boolean; marks?: boolean; color?: 'rgb' | 'cmyk'; pdfx?: boolean } = {},
): Promise<{ bytes: Uint8Array; missingFonts: string[]; rgbImages: number }> {
  const cmyk = opts.color === 'cmyk' || !!opts.pdfx;
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pt = (px: number) => pxToPt(doc, px);
  const bleedPx = opts.bleed ? Math.max(0, doc.layout?.bleed ?? 0) : 0;
  const bp = pt(bleedPx);
  // Les traits de coupe commencent 3 pt après le fond perdu et mesurent 12 pt.
  const MARK_GAP = 3,
    MARK_LEN = 12;
  const pad = opts.marks ? bp + MARK_GAP + MARK_LEN + 3 : bp;
  const size = (ab: Artboard): [number, number] => [pt(ab.width) + 2 * pad, pt(ab.height) + 2 * pad];
  const orientation = (ab: Artboard) => (ab.width > ab.height ? 'landscape' : 'portrait');
  const first = artboards[0];
  const pdf = new jsPDF({ unit: 'pt', format: size(first), orientation: orientation(first) });
  const { embedFonts } = await import('./pdfFonts');
  const missingFonts = await embedFonts(pdf, doc, artboards);
  const mat = await materialize(doc);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < artboards.length; i++) {
      const ab = artboards[i];
      if (i > 0) pdf.addPage(size(ab), orientation(ab));
      await exportImages.ready(doc);
      const fx = await rasterizedParts(doc, ab, true);
      host.innerHTML = artboardToSvg(mat, ab, {
        measureText,
        bleed: bleedPx,
        override: (n) => fx.get(n.id) ?? null,
      });
      const svg = host.querySelector('svg')!;
      // Les images JPEG passent en PNG : leurs pixels pourront être convertis en CMJN.
      if (cmyk) await jpegToPng(svg);
      const W = pt(ab.width),
        H = pt(ab.height);
      await svg2pdf(svg, pdf, { x: pad - bp, y: pad - bp, width: W + 2 * bp, height: H + 2 * bp });
      const box = (m: number) => ({
        bottomLeftX: pad - m,
        bottomLeftY: pad - m,
        topRightX: pad + W + m,
        topRightY: pad + H + m,
      });
      const ctx = pdf.getCurrentPageInfo().pageContext as Record<string, unknown>;
      ctx.trimBox = box(0);
      ctx.bleedBox = box(bp);
      if (opts.marks) {
        // Couleur de repérage : 100 % de chaque encre, pour apparaître sur toutes les plaques.
        pdf.setDrawColor(1, 1, 1, 1);
        pdf.setLineWidth(0.25);
        const o = bp + MARK_GAP;
        for (const [x, sx] of [
          [pad, -1],
          [pad + W, 1],
        ] as const)
          for (const [y, sy] of [
            [pad, -1],
            [pad + H, 1],
          ] as const) {
            pdf.line(x + sx * o, y, x + sx * (o + MARK_LEN), y);
            pdf.line(x, y + sy * o, x, y + sy * (o + MARK_LEN));
          }
      }
    }
  } finally {
    host.remove();
  }
  pdf.setProperties({ title: doc.name, creator: `Poulpe Design ${__APP_VERSION__}` });
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  if (!cmyk) return { bytes, missingFonts, rgbImages: 0 };
  const res = preparePrintPdf(bytes, {
    pdfx: opts.pdfx,
    title: doc.name,
    creator: `Poulpe Design ${__APP_VERSION__}`,
    doc,
  });
  return {
    bytes: res.bytes,
    missingFonts: [...new Set([...missingFonts, ...res.warnings.unembeddedFonts])],
    rgbImages: res.warnings.rgbImages,
  };
}

/** Remplace les images JPEG d'un SVG par des PNG (mêmes pixels). */
async function jpegToPng(svg: SVGSVGElement): Promise<void> {
  for (const el of svg.querySelectorAll('image')) {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    if (!/^data:image\/(jpe?g|webp|gif)/.test(href)) continue;
    const img = new Image();
    img.src = href;
    try {
      await img.decode();
    } catch {
      continue;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1;
    canvas.height = img.naturalHeight || 1;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    el.setAttribute('href', canvas.toDataURL('image/png'));
    el.removeAttribute('xlink:href');
  }
}

/** Pages à exporter selon les options. */
export function exportTargets(
  doc: PoulpeDocument,
  opts: Pick<ExportOptions, 'artboardId' | 'pages'>,
): Artboard[] {
  const pages = printablePages(doc);
  if (opts.artboardId === 'all') return pages;
  if (opts.artboardId === 'range') return parsePageRange(opts.pages ?? '', pages.length).map((i) => pages[i]);
  return doc.artboards.filter((a) => a.id === opts.artboardId);
}

export async function exportDocument(opts: ExportOptions): Promise<void> {
  const doc = editor.doc;
  const artboards = exportTargets(doc, opts);
  if (!artboards.length) {
    toast(t('export.noPages'));
    return;
  }
  if (opts.kind === 'pdf') {
    const { bytes, missingFonts, rgbImages } = await svgToPdf(doc, artboards, opts);
    if (await saveBytes(bytes, 'pdf', doc.name))
      toast(
        missingFonts.length
          ? t(opts.pdfx ? 'export.pdfxFontsMissing' : 'export.pdfFontsMissing', {
              fonts: missingFonts.join(', '),
            })
          : rgbImages
            ? t('export.rgbImages', { n: rgbImages })
            : t('file.exported'),
      );
    return;
  }
  let done = false;
  for (const ab of artboards) {
    const name = artboards.length > 1 || doc.artboards.length > 1 ? `${doc.name} - ${ab.name}` : doc.name;
    const bytes = await artboardBytes(doc, ab, opts.kind, opts);
    if (!(await saveBytes(bytes, opts.kind, name))) break;
    done = true;
  }
  if (done) toast(t('file.exported'));
}

/** Fichier d'un plan de travail dans un format d'export (PDF d'une seule page). */
async function artboardBytes(
  doc: PoulpeDocument,
  ab: Artboard,
  kind: ExportKind,
  opts: Pick<ExportOptions, 'scale' | 'quality' | 'transparent'> & Partial<ExportOptions>,
): Promise<Uint8Array> {
  if (kind === 'pdf') return (await svgToPdf(doc, [ab], opts)).bytes;
  if (kind === 'psd') {
    const { artboardToPsd } = await import('./importers/psd');
    return artboardToPsd(doc, ab, exportImages);
  }
  if (kind === 'svg') {
    const parts = await rasterizedParts(doc, ab, false);
    return new TextEncoder().encode(
      artboardToSvg(await materialize(doc), ab, {
        measureText,
        background: !opts.transparent,
        override: (n) => parts.get(n.id) ?? null,
      }),
    );
  }
  const blob = await rasterizeArtboard(doc, ab, exportImages, {
    scale: opts.scale,
    type: kind === 'png' ? 'image/png' : 'image/jpeg',
    quality: opts.quality,
    background: !(opts.transparent && kind === 'png'),
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface BatchExportOptions {
  artboardIds: string[];
  formats: ExportKind[];
  /** Échelles des images PNG et JPEG (1 = taille du document). */
  scales: number[];
  quality: number;
  transparent: boolean;
  /** PDF en CMJN pour l'imprimeur. */
  cmyk: boolean;
}

/** Exporte plusieurs plans de travail dans plusieurs formats et tailles, réunis dans un fichier ZIP. */
export async function batchExport(opts: BatchExportOptions): Promise<void> {
  const doc = editor.doc;
  const artboards = doc.artboards.filter((a) => opts.artboardIds.includes(a.id));
  if (!artboards.length || !opts.formats.length) {
    toast(t('export.noPages'));
    return;
  }
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const unique = (name: string) => {
    let n = name,
      i = 2;
    while (used.has(n.toLowerCase())) n = name.replace(/(\.[^.]+)$/, ` (${i++})$1`);
    used.add(n.toLowerCase());
    return n;
  };
  const total = artboards.length * opts.formats.length;
  let step = 0;
  for (const ab of artboards) {
    for (const kind of opts.formats) {
      toast(t('export.batchProgress', { n: ++step, total }));
      const scales = kind === 'png' || kind === 'jpeg' ? opts.scales : [1];
      for (const scale of scales.length ? scales : [1]) {
        const bytes = await artboardBytes(doc, ab, kind, {
          scale,
          quality: opts.quality,
          transparent: opts.transparent,
          color: opts.cmyk ? 'cmyk' : 'rgb',
        });
        const suffix = scales.length > 1 || scale !== 1 ? `@${scale}x` : '';
        files[unique(`${safeName(ab.name)}${suffix}.${KINDS[kind].ext}`)] = bytes;
      }
    }
  }
  const zip = zipSync(files, { level: 0 });
  if (await saveBytes(zip, 'zip', `${doc.name} - export`))
    toast(t('export.batchDone', { n: Object.keys(files).length }));
}
