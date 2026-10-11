import {
  FIELD_PAGE,
  arrangePages,
  artboardAt,
  createText,
  documentPages,
  duplicateArtboard,
  findArtboard,
  findNode,
  insertPage,
  movePage,
  nextMasterLetter,
  textChain,
  type Artboard,
  type DocumentLayout,
  type TextNode,
  type Vec,
} from '@poulpe/core';
import { cachedFlow } from '@poulpe/render';
import { insertEditedText, isEditingText } from './canvas/textEdit';
import { getController } from './components/Viewport';
import { t } from './i18n';
import { editor, toast, ui } from './store';

/*
 * Actions de la Persona Mise en page : pages, pages maîtres, champs, cadres de texte liés et
 * réglages du document. Chacune passe par `editor.apply`, donc s'annule.
 */

export { setPersona } from './photo/persona';

/** Affiche une page (ou une page maître) en entier et en fait la page active. */
export function goToPage(id: string): void {
  editor.setActiveArtboard(id);
  requestAnimationFrame(() => getController()?.zoomToFit());
}

const activePage = (): Artboard | null => findArtboard(editor.doc, editor.getState().activeArtboardId);

/** Ajoute une page après la page active (avec la même page maître). */
export function addPage(): void {
  let id = '';
  editor.apply('history.page', (d) => {
    const after = findArtboard(d, editor.getState().activeArtboardId);
    const ab = insertPage(d, {
      afterId: after && !after.master ? after.id : undefined,
      name: t('pages.pageName', { n: documentPages(d).length + 1 }),
    });
    id = ab.id;
    arrangePages(d);
  });
  goToPage(id);
}

export function duplicatePage(id = editor.getState().activeArtboardId): void {
  let copy = '';
  editor.apply('history.page', (d) => {
    const src = findArtboard(d, id);
    if (!src) return;
    copy = duplicateArtboard(d, id, `${src.name} (${t('pages.copy')})`)?.id ?? '';
    arrangePages(d);
  });
  if (copy) goToPage(copy);
}

/** Supprime une page ou une page maître (les pages qui l'utilisaient n'ont plus de page maître). */
export function deletePage(id = editor.getState().activeArtboardId): void {
  const doc = editor.doc;
  const ab = findArtboard(doc, id);
  if (!ab || (!ab.master && documentPages(doc).length <= 1)) return;
  editor.apply('history.page', (d) => {
    d.artboards = d.artboards.filter((a) => a.id !== id);
    for (const a of d.artboards) if (a.masterId === id) delete a.masterId;
    arrangePages(d);
    return [];
  });
}

export function canDeletePage(id = editor.getState().activeArtboardId): boolean {
  const ab = findArtboard(editor.doc, id);
  return !!ab && (ab.master || documentPages(editor.doc).length > 1);
}

/** Déplace une page à une autre position (glisser dans le panneau Pages). */
export function reorderPage(id: string, toIndex: number): void {
  editor.apply('history.page', (d) => {
    movePage(d, id, toIndex);
    arrangePages(d);
  });
}

/** Crée une page maître de la taille de la page active, et l'applique à cette page si elle n'en a pas. */
export function addMaster(): void {
  let id = '';
  editor.apply('history.master', (d) => {
    const ref = findArtboard(d, editor.getState().activeArtboardId) ?? documentPages(d)[0];
    const letter = nextMasterLetter(d);
    const ab = insertPage(d, {
      afterId: d.artboards[d.artboards.length - 1]?.id,
      name: t('pages.masterName', { l: letter }),
      width: ref?.width,
      height: ref?.height,
    });
    ab.master = true;
    delete ab.masterId;
    id = ab.id;
    if (ref && !ref.master && !ref.masterId) ref.masterId = ab.id;
    arrangePages(d);
  });
  goToPage(id);
}

/** Applique une page maître (ou aucune, avec null) aux pages données. */
export function applyMaster(masterId: string | null, pageIds: string[]): void {
  editor.apply('history.master', (d) => {
    for (const a of d.artboards) {
      if (!pageIds.includes(a.id) || a.master) continue;
      // Une autre page maître : les objets détachés de l'ancienne ne la concernent plus.
      if (a.masterId !== masterId) delete a.masterHidden;
      if (masterId) a.masterId = masterId;
      else delete a.masterId;
    }
  });
}

export function arrange(): void {
  editor.apply('history.page', (d) => void arrangePages(d));
}

/** Change les réglages de mise en page du document ; les pages se rangent si le vis-à-vis change. */
export function updateLayout(patch: Partial<DocumentLayout>): void {
  editor.apply('history.document', (d) => {
    const before = !!d.layout?.facing;
    d.layout = { ...(d.layout ?? {}), ...patch };
    for (const k of Object.keys(d.layout) as (keyof DocumentLayout)[])
      if (d.layout[k] === undefined) delete d.layout[k];
    if (!!d.layout.facing !== before) arrangePages(d);
  });
}

// ————— Champs —————

/**
 * Insère le numéro de page : au curseur pendant l'édition d'un texte, sinon dans un nouveau texte
 * centré en bas de la page active (pratique sur une page maître).
 */
export function insertPageNumber(): void {
  if (isEditingText() && insertEditedText(FIELD_PAGE)) return;
  const ab = activePage();
  if (!ab) return;
  const d = ui.get().defaults;
  const size = Math.max(12, Math.round(Math.min(ab.width, ab.height) * 0.02));
  const bottom = editor.doc.layout?.margins?.bottom ?? size * 2;
  const node = createText(
    {
      x: ab.x + ab.width / 2 - size,
      y: ab.y + ab.height - bottom + size * 0.5,
      width: size * 2,
      height: size,
      text: FIELD_PAGE,
      name: t('pages.pageNumber'),
      autoWidth: true,
    },
    d,
  );
  node.style = { ...node.style, fontSize: size, align: 'center' };
  editor.apply('history.add', (doc) => {
    findArtboard(doc, ab.id)!.children.push(node);
    return [node.id];
  });
}

// ————— Cadres de texte liés —————

/** Texte sélectionné seul. */
function selectedText(): TextNode | null {
  const s = editor.selection;
  const n = s.length === 1 ? findNode(editor.doc, s[0])?.node : null;
  return n?.type === 'text' && !n.path ? n : null;
}

export function canToggleFrame(): boolean {
  return selectedText() !== null;
}

/** Passe un texte en cadre de texte (hauteur fixe) ou le remet en bloc dont la hauteur suit le texte. */
export function toggleFrame(): void {
  const n = selectedText();
  if (!n) return;
  const on = !n.frame;
  if (!on && textChain(editor.doc, n.id).length > 1) {
    toast(t('frames.unlinkFirst'));
    return;
  }
  editor.apply('history.frame', (d) => {
    const m = findNode(d, n.id)?.node;
    if (m?.type !== 'text') return;
    if (on) {
      m.frame = true;
      m.autoWidth = false;
    } else delete m.frame;
  });
}

/**
 * Lie le cadre `fromId` (le dernier de sa chaîne) à un cadre suivant : un texte existant, ou un
 * nouveau cadre de même taille posé au point `p`. Le texte d'un cadre existant rejoint la chaîne.
 */
export function linkTextFrames(fromId: string, targetId: string | null, p: Vec): void {
  const doc = editor.doc;
  const chain = textChain(doc, fromId);
  const tail = chain[chain.length - 1];
  if (!tail) return;
  if (targetId) {
    const target = findNode(doc, targetId)?.node;
    if (target?.type !== 'text' || target.path) return;
    if (chain.some((c) => c.id === targetId)) return;
    const other = textChain(doc, targetId);
    if (other[0].id !== targetId) {
      toast(t('frames.alreadyLinked'));
      return;
    }
    editor.apply('history.link', (d) => {
      const tl = findNode(d, tail.id)!.node as TextNode;
      const head = findNode(d, chain[0].id)!.node as TextNode;
      const tg = findNode(d, targetId)!.node as TextNode;
      if (tg.text.trim()) head.text = head.text ? `${head.text}\n${tg.text}` : tg.text;
      tg.text = '';
      delete tg.runs;
      tg.frame = true;
      tg.autoWidth = false;
      tl.frame = true;
      tl.next = tg.id;
      return [tg.id];
    });
    return;
  }
  const ab = artboardAt(doc, p) ?? activePage();
  if (!ab) return;
  const frame = createText(
    { x: p.x, y: p.y, width: tail.width, height: tail.height, name: t('name.textFrame'), autoWidth: false },
    ui.get().defaults,
  );
  frame.frame = true;
  editor.apply('history.link', (d) => {
    findArtboard(d, ab.id)!.children.push(frame);
    const tl = findNode(d, tail.id)!.node as TextNode;
    tl.frame = true;
    tl.next = frame.id;
    return [frame.id];
  });
}

export function canLinkSelection(): boolean {
  const s = editor.selection;
  if (s.length !== 2) return false;
  return s.every((id) => {
    const n = findNode(editor.doc, id)?.node;
    return n?.type === 'text' && !n.path;
  });
}

/** Lie deux textes sélectionnés : le premier sélectionné coule dans le second. */
export function linkSelection(): void {
  if (!canLinkSelection()) return;
  const [a, b] = editor.selection;
  linkTextFrames(a, b, { x: 0, y: 0 });
}

export function canUnlink(): boolean {
  const n = selectedText();
  return !!n && textChain(editor.doc, n.id).length > 1;
}

/** Sort le cadre sélectionné de sa chaîne ; la chaîne se referme sans lui. */
export function unlinkSelected(): void {
  const n = selectedText();
  if (!n) return;
  const chain = textChain(editor.doc, n.id);
  if (chain.length < 2) return;
  const i = chain.findIndex((c) => c.id === n.id);
  editor.apply('history.unlink', (d) => {
    const get = (id: string) => findNode(d, id)!.node as TextNode;
    if (i === 0) {
      // Le texte passe au cadre suivant, qui devient le premier de la chaîne ; le cadre sorti reste vide.
      const second = get(chain[1].id);
      const head = get(n.id);
      second.text = head.text;
      second.style = head.style;
      if (head.runs) second.runs = head.runs;
      head.text = '';
      delete head.runs;
      delete head.next;
    } else {
      const prev = get(chain[i - 1].id);
      const me = get(n.id);
      if (me.next) prev.next = me.next;
      else delete prev.next;
      delete me.next;
    }
  });
}

/** Répartition du texte d'une chaîne dans ses cadres (début et fin de chaque part). */
export function flowParts(id: string): { id: string; start: number; end: number }[] {
  return cachedFlow(editor.doc, id, null).parts.map((p) => ({ id: p.node.id, start: p.start, end: p.end }));
}
