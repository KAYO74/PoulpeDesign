import {
  arrangePages,
  detachFromMaster,
  detachMasterObject,
  documentPages,
  duplicateArtboard,
  findArtboard,
  insertPage,
  masterOf,
  hitNode,
  pageNumber,
  type Artboard,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { t } from '../../i18n';
import { parsePageRange } from '../../io';
import { goToPage } from '../../layoutActions';
import { editor, toast } from '../../store';
import { framesState } from './state';

/*
 * Panneau Pages, comme dans Affinity Publisher : plusieurs pages choisies à la fois (Maj ou
 * Ctrl + clic), ajout de plusieurs pages, page maître appliquée à un ensemble de pages, objets
 * de la page maître détachés sur une page.
 */

/** Pages choisies dans le panneau : la sélection multiple, sinon la page active. */
export function chosenPages(doc: PoulpeDocument = editor.doc): string[] {
  const active = editor.getState().activeArtboardId;
  const ids = framesState.get().pages.filter((id) => doc.artboards.some((a) => a.id === id));
  if (ids.length && ids.includes(active))
    return doc.artboards.filter((a) => ids.includes(a.id)).map((a) => a.id);
  return doc.artboards.some((a) => a.id === active) ? [active] : [];
}

/**
 * Clic sur une page du panneau : Ctrl (ou Cmd) l'ajoute ou la retire du choix, Maj choisit toutes
 * les pages depuis la page active. Un clic simple ne choisit qu'elle.
 */
export function clickPage(id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
  const doc = editor.doc;
  const ab = findArtboard(doc, id);
  if (!ab) return;
  const current = chosenPages(doc);
  if (e.ctrlKey || e.metaKey) {
    const next = current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
    // La page active reste dans le choix (elle sert de repère au prochain Maj + clic).
    const active = next.includes(id) ? id : (next[next.length - 1] ?? id);
    framesState.set({ pages: next.length ? next : [id] });
    goToPage(active);
    return;
  }
  if (e.shiftKey && !ab.master) {
    const pages = documentPages(doc);
    const from = pages.findIndex((p) => p.id === editor.getState().activeArtboardId);
    const to = pages.findIndex((p) => p.id === id);
    if (from >= 0 && to >= 0) {
      const ids = pages.slice(Math.min(from, to), Math.max(from, to) + 1).map((p) => p.id);
      framesState.set({ pages: ids });
      editor.setActiveArtboard(id);
      return;
    }
  }
  framesState.set({ pages: [id] });
  goToPage(id);
}

/** Supprime les pages choisies (il reste au moins une page). */
export function deletePages(ids: string[] = chosenPages()): void {
  const doc = editor.doc;
  const set = new Set(ids);
  const pagesLeft = documentPages(doc).filter((p) => !set.has(p.id)).length;
  if (!pagesLeft) {
    toast(t('frames.keepOnePage'));
    return;
  }
  editor.apply('history.page', (d) => {
    d.artboards = d.artboards.filter((a) => !set.has(a.id));
    for (const a of d.artboards)
      if (a.masterId && set.has(a.masterId)) {
        delete a.masterId;
        delete a.masterHidden;
      }
    arrangePages(d);
    return [];
  });
  framesState.set({ pages: [] });
}

/** Duplique les pages choisies : les copies suivent la dernière d'entre elles, dans le même ordre. */
export function duplicatePages(ids: string[] = chosenPages()): void {
  if (!ids.length) return;
  const copies: string[] = [];
  editor.apply('history.page', (d) => {
    const sources = d.artboards.filter((a) => ids.includes(a.id));
    let last = sources[sources.length - 1];
    for (const src of sources) {
      const copy = duplicateArtboard(d, src.id, `${src.name} (${t('pages.copy')})`);
      if (!copy) continue;
      // La copie part de juste après sa page : on la range après la dernière page choisie.
      d.artboards.splice(d.artboards.indexOf(copy), 1);
      d.artboards.splice(d.artboards.indexOf(last) + 1, 0, copy);
      last = copy;
      copies.push(copy.id);
    }
    arrangePages(d);
    return [];
  });
  if (copies.length) {
    framesState.set({ pages: copies });
    goToPage(copies[0]);
  }
}

export type PagePosition = 'before' | 'after' | 'start' | 'end';

/** Ajoute `count` pages avant ou après une page (ou au début, à la fin), avec la page maître donnée. */
export function addPages(o: {
  count: number;
  position: PagePosition;
  refId: string | null;
  masterId: string | null;
}): void {
  const count = Math.max(1, Math.min(500, Math.round(o.count)));
  let first = '';
  editor.apply('history.page', (d) => {
    const pages = documentPages(d);
    const ref = (o.refId && pages.find((p) => p.id === o.refId)) || pages[pages.length - 1];
    let index =
      o.position === 'start'
        ? 0
        : o.position === 'end' || !ref
          ? pages.length
          : pages.indexOf(ref) + (o.position === 'after' ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const before = documentPages(d)[index - 1];
      const ab = insertPage(d, {
        afterId: before?.id,
        name: t('pages.pageName', { n: documentPages(d).length + 1 }),
        width: ref?.width,
        height: ref?.height,
      });
      if (!before) {
        // Au début : la page va avant la première page.
        d.artboards.splice(d.artboards.indexOf(ab), 1);
        const firstPage = documentPages(d)[0];
        d.artboards.splice(firstPage ? d.artboards.indexOf(firstPage) : 0, 0, ab);
      }
      if (o.masterId) ab.masterId = o.masterId;
      else delete ab.masterId;
      if (!first) first = ab.id;
      index++;
    }
    arrangePages(d);
    return [];
  });
  if (first) goToPage(first);
}

export type MasterScope = 'chosen' | 'all' | 'odd' | 'even' | 'range';

/** Pages visées par « Appliquer la page maître » : toutes, impaires, paires, une plage ou le choix. */
export function pagesInScope(doc: PoulpeDocument, scope: MasterScope, range = ''): string[] {
  const pages = documentPages(doc);
  if (scope === 'chosen') return chosenPages(doc).filter((id) => pages.some((p) => p.id === id));
  if (scope === 'all') return pages.map((p) => p.id);
  if (scope === 'range') return parsePageRange(range, pages.length).map((i) => pages[i].id);
  const odd = scope === 'odd';
  return pages.filter((p) => ((pageNumber(doc, p) ?? 1) % 2 === 1) === odd).map((p) => p.id);
}

/** Détache les pages choisies de leur page maître : elles gardent une copie de ses objets. */
export function detachPages(ids: string[] = chosenPages()): void {
  const doc = editor.doc;
  const targets = ids.filter((id) => {
    const ab = findArtboard(doc, id);
    return ab && masterOf(doc, ab);
  });
  if (!targets.length) return;
  editor.apply('history.detach', (d) => {
    for (const id of targets) detachFromMaster(d, id);
    return [];
  });
}

/** Objet de la page maître visible sous le point, sur une page qui l'utilise. */
export function masterObjectAt(
  doc: PoulpeDocument,
  p: Vec,
  tol: number,
): { page: Artboard; node: SceneNode } | null {
  for (let i = doc.artboards.length - 1; i >= 0; i--) {
    const page = doc.artboards[i];
    if (p.x < page.x || p.y < page.y || p.x > page.x + page.width || p.y > page.y + page.height) continue;
    const master = masterOf(doc, page);
    if (!master) return null;
    const q = { x: p.x - (page.x - master.x), y: p.y - (page.y - master.y) };
    for (let k = master.children.length - 1; k >= 0; k--) {
      const n = master.children[k];
      if (n.visible && hitNode(n, q, tol)) return { page, node: n };
    }
    return null;
  }
  return null;
}

/** Détache un objet de la page maître sur la page (pour le modifier là seulement) et le sélectionne. */
export function detachMasterObjectOnPage(pageId: string, nodeId: string): string | null {
  let copy: string | null = null;
  editor.apply('history.detach', (d) => {
    copy = detachMasterObject(d, pageId, nodeId);
    return copy ? [copy] : undefined;
  });
  if (copy) toast(t('frames.detached'));
  return copy;
}
