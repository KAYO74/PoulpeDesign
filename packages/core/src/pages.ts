import { current, isDraft } from 'immer';
import { createArtboard } from './factory';
import type { PageFields } from './flow';
import { newId } from './ids';
import { cloneNodesKeepLinks, cloneWithNewIds, translateNode } from './tree';
import type { Artboard, DocumentLayout, Margins, PoulpeDocument } from './types';

/*
 * Pages et pages maîtres (Persona Mise en page).
 *
 * Une page est un plan de travail ; l'ordre des pages est celui de `doc.artboards`. Une page
 * maître est un plan de travail marqué `master` : elle n'est pas une page, ses objets
 * apparaissent sous ceux des pages qui l'utilisent, au même endroit relatif.
 */

export const SCREEN_DPI = 96;

/** Résolution du document (pixels par pouce). */
export function documentDpi(doc: Pick<PoulpeDocument, 'layout'>): number {
  return doc.layout?.dpi && doc.layout.dpi > 0 ? doc.layout.dpi : SCREEN_DPI;
}

/** Pixels du document vers millimètres. */
export function pxToMm(doc: Pick<PoulpeDocument, 'layout'>, px: number): number {
  return (px / documentDpi(doc)) * 25.4;
}

/** Millimètres vers pixels du document. */
export function mmToPx(doc: Pick<PoulpeDocument, 'layout'>, mm: number): number {
  return (mm / 25.4) * documentDpi(doc);
}

/** Pixels du document vers points PDF (1/72 de pouce). */
export function pxToPt(doc: Pick<PoulpeDocument, 'layout'>, px: number): number {
  return (px / documentDpi(doc)) * 72;
}

export function isMaster(ab: Artboard): boolean {
  return !!ab.master;
}

export function documentPages(doc: PoulpeDocument): Artboard[] {
  return doc.artboards.filter((a) => !a.master);
}

export function documentMasters(doc: PoulpeDocument): Artboard[] {
  return doc.artboards.filter((a) => a.master);
}

/** Page maître vue depuis une page qui en a détaché des objets, mémorisée tant que rien ne change. */
const withoutHidden = new WeakMap<Artboard, WeakMap<string[], Artboard>>();

/**
 * Page maître d'une page, si elle existe encore. Les objets détachés sur la page (`masterHidden`)
 * n'y figurent pas : la page en a sa propre copie.
 */
export function masterOf(doc: PoulpeDocument, page: Artboard): Artboard | null {
  if (!page.masterId || page.master) return null;
  const m = doc.artboards.find((a) => a.id === page.masterId);
  if (!m?.master) return null;
  const hidden = page.masterHidden;
  if (!hidden?.length) return m;
  let byHidden = withoutHidden.get(m);
  if (!byHidden) withoutHidden.set(m, (byHidden = new WeakMap()));
  let out = byHidden.get(hidden);
  if (!out) {
    const set = new Set(hidden);
    out = { ...m, children: m.children.filter((c) => !set.has(c.id)) };
    byHidden.set(hidden, out);
  }
  return out;
}

/**
 * Détache un objet de la page maître sur une page (comme « Modifier détaché » d'Affinity
 * Publisher) : la page en reçoit une copie modifiable, au même endroit, et ne montre plus
 * l'original. Renvoie l'id de la copie.
 */
export function detachMasterObject(doc: PoulpeDocument, pageId: string, nodeId: string): string | null {
  const page = doc.artboards.find((a) => a.id === pageId);
  const master = page && masterOf(doc, page);
  if (!page || !master) return null;
  const index = master.children.findIndex((c) => c.id === nodeId);
  if (index < 0) return null;
  const copy = cloneWithNewIds(master.children[index]);
  translateNode(copy, page.x - master.x, page.y - master.y);
  // Sous les objets de la page, dans l'ordre de la page maître parmi les objets déjà détachés.
  const full = doc.artboards.find((a) => a.id === page.masterId)!;
  const hidden = new Set(page.masterHidden ?? []);
  const below = full.children.slice(
    0,
    full.children.findIndex((c) => c.id === nodeId),
  );
  const at = Math.min(page.children.length, below.filter((c) => hidden.has(c.id)).length);
  page.children.splice(at, 0, copy);
  page.masterHidden = [...(page.masterHidden ?? []), nodeId];
  return copy.id;
}

/** Détache une page de sa page maître : elle garde une copie de ses objets et n'y est plus liée. */
export function detachFromMaster(doc: PoulpeDocument, pageId: string): string[] {
  const page = doc.artboards.find((a) => a.id === pageId);
  const master = page && masterOf(doc, page);
  if (!page) return [];
  const copies = (master?.children ?? []).map((n) => {
    const c = cloneWithNewIds(n);
    translateNode(c, page.x - master!.x, page.y - master!.y);
    return c;
  });
  page.children.splice(0, 0, ...copies);
  delete page.masterId;
  delete page.masterHidden;
  return copies.map((c) => c.id);
}

/** Numéro affiché d'une page (le premier numéro peut être réglé), ou null pour une page maître. */
export function pageNumber(doc: PoulpeDocument, ab: Artboard): number | null {
  if (ab.master) return null;
  const i = documentPages(doc).findIndex((a) => a.id === ab.id);
  return i < 0 ? null : i + (doc.layout?.firstNumber ?? 1);
}

/** Valeurs des champs sur un plan de travail (« # » sur une page maître, comme dans Affinity). */
export function pageFields(doc: PoulpeDocument, ab: Artboard | null | undefined): PageFields {
  const pages = String(documentPages(doc).length);
  const n = ab ? pageNumber(doc, ab) : null;
  return { page: n === null ? '#' : String(n), pages: ab?.master ? '#' : pages };
}

/** Une page de gauche dans un document en vis-à-vis (les pages paires). */
export function isLeftPage(doc: PoulpeDocument, ab: Artboard): boolean {
  const n = pageNumber(doc, ab);
  return !!doc.layout?.facing && n !== null && n % 2 === 0;
}

/** Marges d'une page en pixels, gauche et droite résolues selon le côté de la reliure. */
export function pageMargins(
  doc: PoulpeDocument,
  ab: Artboard,
): { top: number; bottom: number; left: number; right: number } | null {
  const m: Margins | undefined = doc.layout?.margins;
  if (!m) return null;
  const left = isLeftPage(doc, ab);
  return {
    top: m.top,
    bottom: m.bottom,
    left: left ? m.outside : m.inside,
    right: left ? m.inside : m.outside,
  };
}

/** Déplace un plan de travail et tout son contenu. */
export function moveArtboard(ab: Artboard, x: number, y: number): void {
  const dx = x - ab.x,
    dy = y - ab.y;
  if (!dx && !dy) return;
  ab.children.forEach((n) => translateNode(n, dx, dy));
  ab.x = x;
  ab.y = y;
}

/**
 * Range les pages comme dans un logiciel de mise en page : une colonne de pages, ou des doubles
 * pages (la page 1 seule à droite) si le document est en vis-à-vis. Les pages maîtres forment
 * une colonne à gauche.
 */
export function arrangePages(doc: PoulpeDocument): void {
  const pages = documentPages(doc);
  const masters = documentMasters(doc);
  if (!pages.length) return;
  const facing = !!doc.layout?.facing;
  const ref = pages[0];
  const gap = Math.max(40, Math.round(Math.max(ref.width, ref.height) * 0.08));
  const x0 = pages[0].x,
    y0 = pages[0].y;
  let y = y0;
  if (!facing) {
    for (const p of pages) {
      moveArtboard(p, x0, y);
      y += p.height + gap;
    }
  } else {
    // La page 1 est à droite de la reliure ; les doubles pages se suivent vers le bas.
    let i = 0;
    let row = 0;
    while (i < pages.length) {
      const spread = row === 0 ? [null, pages[0]] : [pages[i], pages[i + 1] ?? null];
      const left = spread[0],
        right = spread[1];
      const leftW = left?.width ?? right!.width;
      if (left) moveArtboard(left, x0, y);
      if (right) moveArtboard(right, x0 + leftW, y);
      y += Math.max(left?.height ?? 0, right?.height ?? 0) + gap;
      i += row === 0 ? 1 : 2;
      row++;
    }
  }
  let my = y0;
  const widest = Math.max(...masters.map((m) => m.width), 0);
  for (const m of masters) {
    moveArtboard(m, x0 - gap * 3 - widest, my);
    my += m.height + gap;
  }
}

/** Nom d'une nouvelle page maître : « A-Maître », « B-Maître »… (le suffixe vient de l'interface). */
export function nextMasterLetter(doc: PoulpeDocument): string {
  const used = new Set(documentMasters(doc).map((m) => m.name.charAt(0)));
  for (let c = 65; c < 91; c++) if (!used.has(String.fromCharCode(c))) return String.fromCharCode(c);
  return String(documentMasters(doc).length + 1);
}

/** Ajoute une page après `afterId` (à la fin sinon), de la taille de la page de référence. */
export function insertPage(
  doc: PoulpeDocument,
  opts: { afterId?: string; name: string; masterId?: string; width?: number; height?: number },
): Artboard {
  const pages = documentPages(doc);
  const after = (opts.afterId && doc.artboards.find((a) => a.id === opts.afterId)) || pages[pages.length - 1];
  const ref = after ?? doc.artboards[0];
  const ab = createArtboard({
    x: ref ? ref.x : 0,
    y: ref ? ref.y + ref.height : 0,
    width: opts.width ?? ref?.width ?? 1080,
    height: opts.height ?? ref?.height ?? 1350,
    name: opts.name,
  });
  ab.background = ref?.background ?? ab.background;
  const masterId = opts.masterId ?? (ref && !ref.master ? ref.masterId : undefined);
  if (masterId) ab.masterId = masterId;
  const index = after ? doc.artboards.indexOf(after) + 1 : doc.artboards.length;
  doc.artboards.splice(index, 0, ab);
  return ab;
}

/** Copie d'un plan de travail (page ou page maître) et de son contenu, placée juste après lui. */
export function duplicateArtboard(doc: PoulpeDocument, id: string, name: string): Artboard | null {
  const src = doc.artboards.find((a) => a.id === id);
  if (!src) return null;
  const copy: Artboard = {
    ...structuredClone({ ...(isDraft(src) ? current(src) : src), children: [] }),
    id: newId('ab'),
    name,
    children: cloneNodesKeepLinks(src.children),
  };
  doc.artboards.splice(doc.artboards.indexOf(src) + 1, 0, copy);
  return copy;
}

/** Déplace une page à une nouvelle position parmi les pages. */
export function movePage(doc: PoulpeDocument, id: string, toPageIndex: number): void {
  const from = doc.artboards.findIndex((a) => a.id === id);
  if (from < 0) return;
  const [ab] = doc.artboards.splice(from, 1);
  const pages = documentPages(doc);
  const target = pages[Math.max(0, Math.min(toPageIndex, pages.length))];
  const at = target ? doc.artboards.indexOf(target) : doc.artboards.length;
  doc.artboards.splice(at, 0, ab);
}

/** Les plans de travail à imprimer ou exporter comme pages (sans les pages maîtres). */
export function printablePages(doc: PoulpeDocument): Artboard[] {
  const pages = documentPages(doc);
  return pages.length ? pages : doc.artboards;
}

export function layoutOf(doc: PoulpeDocument): DocumentLayout {
  return doc.layout ?? {};
}
