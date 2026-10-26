import { makeRoomForDocument } from './docTabs';
import {
  applyPalette,
  boxCenter,
  clearRunKeys,
  cloneWithNewIds,
  createArtboard,
  createImage,
  findArtboard,
  findNode,
  isGradient,
  newId,
  nodeBounds,
  putImageInFrame,
  resizeArtboard,
  scaleNode,
  topLevelIds,
  translateNode,
  walk,
  type Artboard,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  type Vec,
} from '@poulpe/core';
import {
  FONT_PAIRINGS,
  FRAMES,
  ICONS,
  ICON_VIEWBOX,
  ILLUSTRATIONS,
  SHAPES,
  TEMPLATES,
  TEXT_PRESETS,
  fillArtboard,
  iconName,
  path,
  templateDocument,
  text,
  type FontPairing,
  type Palette,
  type TemplateDef,
  type TextPreset,
} from '@poulpe/library';
import { getLang, t } from './i18n';
import { normalizeTexts } from './normalize';
import { editor, toast, ui } from './store';

/*
 * Actions de la bibliothèque (côté Canva) : ajouter des éléments, appliquer un modèle, une palette
 * ou une combinaison de polices, redimensionner un design. Chacune s'annule d'un seul coup.
 */

const fit = () => requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));

function activeArtboard(doc: PoulpeDocument = editor.doc): Artboard | null {
  return findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0] ?? null;
}

/** Couleur des formes et icônes ajoutées : le remplissage courant, ou le turquoise de Poulpe. */
function currentColor(): string {
  const f = ui.get().defaults.fill;
  if (f.type === 'solid') return f.color;
  if (isGradient(f)) return f.stops[0]?.color ?? '#2ba59a';
  return '#2ba59a';
}

/**
 * Ajoute un objet au plan de travail actif, centré (ou au point visé), à une taille en rapport
 * avec le format : `share` est la part du plus petit côté du plan de travail.
 */
export function insertNode(node: SceneNode, opts: { label: string; at?: Vec; share?: number }): void {
  const ab = activeArtboard();
  if (!ab) return;
  const target = (opts.share ?? 0.4) * Math.min(ab.width, ab.height);
  const b = nodeBounds(node);
  const k = target / Math.max(b.width, b.height);
  scaleNode(node, k, k, { x: b.x, y: b.y }, true);
  const nb = nodeBounds(node);
  const c = opts.at ?? boxCenter(ab);
  translateNode(node, c.x - (nb.x + nb.width / 2), c.y - (nb.y + nb.height / 2));
  // Un point visé hors de tout plan de travail : l'objet va quand même dans le plan actif.
  editor.apply(opts.label, (d) => {
    const target = findArtboard(d, ab.id)!;
    target.children.push(node);
    return [node.id];
  });
  ui.set({ tool: 'select' });
}

export type ElementKind = 'shape' | 'frame' | 'icon' | 'illustration' | 'text';

/** Fabrique un élément de la bibliothèque, prêt à être placé. */
function buildElement(kind: ElementKind, id: string): { node: SceneNode; share: number } | null {
  const lang = getLang();
  if (kind === 'shape') {
    const def = SHAPES.find((s) => s.id === id);
    return def ? { node: def.build(currentColor()), share: 0.4 } : null;
  }
  if (kind === 'frame') {
    const def = FRAMES.find((s) => s.id === id);
    return def ? { node: def.build('#000'), share: 0.5 } : null;
  }
  if (kind === 'icon') {
    const def = ICONS.find((i) => i.id === id);
    if (!def) return null;
    const node = path(def.d, [ICON_VIEWBOX, ICON_VIEWBOX], 0, 0, ICON_VIEWBOX, ICON_VIEWBOX, currentColor(), {
      name: iconName(def, lang),
    });
    return { node, share: 0.25 };
  }
  if (kind === 'illustration') {
    const def = ILLUSTRATIONS.find((i) => i.id === id);
    return def ? { node: def.build(lang), share: 0.5 } : null;
  }
  return null;
}

export function addElement(kind: ElementKind, id: string, at?: Vec): void {
  if (kind === 'text') {
    const preset = TEXT_PRESETS.find((p) => p.id === id);
    if (preset) addTextPreset(preset, at);
    return;
  }
  const el = buildElement(kind, id);
  if (el) insertNode(el.node, { label: 'history.element', at, share: el.share });
}

/** Ajoute un texte (titre, sous-titre, texte courant) à une taille adaptée au format. */
export function addTextPreset(preset: TextPreset, at?: Vec): void {
  const ab = activeArtboard();
  if (!ab) return;
  const k = Math.min(ab.width, ab.height) / 1080;
  const node = text(0, 0, 100, preset.name[getLang()], '#1a1a1d', {
    size: Math.round(preset.size * k),
    weight: preset.weight,
    name: preset.name[getLang()],
  });
  measureNow(node);
  const c = at ?? boxCenter(ab);
  translateNode(node, c.x - node.width / 2, c.y - node.height / 2);
  editor.apply('history.element', (d) => {
    findArtboard(d, ab.id)!.children.push(node);
    return [node.id];
  });
  ui.set({ tool: 'select' });
}

/** Donne sa vraie taille à un texte avant de le placer. */
function measureNow(node: SceneNode) {
  const tmp = { artboards: [{ children: [node] }] } as unknown as PoulpeDocument;
  normalizeTexts(tmp);
}

/* ——— Modèles ——— */

/**
 * Applique un modèle : il remplit le plan de travail actif s'il est vide (en prenant le format du
 * modèle), sinon il arrive dans un nouveau plan de travail à droite des autres.
 */
export function applyTemplate(def: TemplateDef): void {
  const lang = getLang();
  const doc = editor.doc;
  const ab = activeArtboard(doc);
  const tpl = templateDocument(def, lang).artboards[0];
  let targetId: string;
  if (ab && ab.children.length === 0) {
    targetId = ab.id;
    editor.apply('history.template', (d) => {
      const a = findArtboard(d, ab.id)!;
      a.width = tpl.width;
      a.height = tpl.height;
      a.name = def.name[lang];
      fillArtboard(a, def, lang);
      return [];
    });
  } else {
    const right = Math.max(0, ...doc.artboards.map((a) => a.x + a.width));
    const created = createArtboard({
      x: doc.artboards.length ? right + 100 : 0,
      y: doc.artboards[0]?.y ?? 0,
      width: tpl.width,
      height: tpl.height,
      name: def.name[lang],
    });
    targetId = created.id;
    fillArtboard(created, def, lang);
    editor.apply('history.template', (d) => {
      d.artboards.push(created);
      return [];
    });
  }
  editor.setActiveArtboard(targetId);
  fit();
}

/** Nouveau document à partir d'un modèle. */
export function newFromTemplate(def: TemplateDef): void {
  makeRoomForDocument();
  editor.load(templateDocument(def, getLang()));
  ui.set({ filePath: null, dialog: null });
  fit();
}

export function templatesForFormat(format: string | null): TemplateDef[] {
  return format ? TEMPLATES.filter((t) => t.format === format) : TEMPLATES;
}

/* ——— Styles ——— */

let lastPalette: { id: string; variant: number } | null = null;

/**
 * Applique une palette à la sélection ou, sans sélection, au plan de travail actif (fond compris).
 * Un nouveau clic sur la même palette propose une autre répartition des couleurs.
 */
export function applyPaletteToDesign(p: Palette): void {
  const variant = lastPalette?.id === p.id ? lastPalette.variant + 1 : 0;
  lastPalette = { id: p.id, variant };
  const ids = topLevelIds(editor.doc, editor.selection);
  const abId = editor.getState().activeArtboardId;
  editor.apply('history.palette', (d) => {
    if (ids.length) applyPalette({ nodes: ids.map((id) => findNode(d, id)!.node) }, p.colors, variant);
    else {
      const ab = findArtboard(d, abId);
      if (ab) applyPalette({ artboard: ab, nodes: ab.children }, p.colors, variant);
    }
  });
}

/** Ajoute les couleurs d'une palette au nuancier du document. */
export function addPaletteToSwatches(p: Palette): void {
  editor.apply('history.swatch', (d) => {
    for (const c of p.colors) if (!d.swatches.includes(c)) d.swatches.push(c);
  });
  toast(t('library.paletteAdded'));
}

function textsIn(nodes: SceneNode[], ab: Artboard): TextNode[] {
  const out: TextNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') out.push(n);
    if (n.type === 'group')
      for (const l of walk(n.children, n, ab)) if (l.node.type === 'text') out.push(l.node);
  }
  return out;
}

/**
 * Applique une combinaison de polices aux textes sélectionnés ou, sans sélection, à ceux du plan
 * de travail actif : les plus grands prennent la police de titre, les autres celle du texte
 * courant. S'il n'y a aucun texte, ajoute un titre et un sous-titre dans ces polices.
 */
export function applyFontPairing(p: FontPairing): void {
  const doc = editor.doc;
  const ab = activeArtboard(doc);
  if (!ab) return;
  const sel = topLevelIds(doc, editor.selection);
  const scope = sel.length ? sel.map((id) => findNode(doc, id)!.node) : ab.children;
  const texts = textsIn(scope, ab);
  if (!texts.length) {
    insertPairing(p, ab);
    return;
  }
  const max = Math.max(...texts.map((n) => n.style.fontSize));
  const ids = new Set(texts.map((n) => n.id));
  editor.apply('history.text', (d) => {
    for (const l of walk(
      findArtboard(d, ab.id)!.children,
      findArtboard(d, ab.id)!,
      findArtboard(d, ab.id)!,
    )) {
      const n = l.node;
      if (n.type !== 'text' || !ids.has(n.id)) continue;
      const title = n.style.fontSize >= max * 0.7;
      const f = title ? p.title : p.body;
      n.style = {
        ...n.style,
        fontFamily: f.font,
        fontWeight: f.weight,
        italic: f.italic ?? false,
        ...(title
          ? { uppercase: p.title.upper ?? false, letterSpacing: (p.title.spacing ?? 0) * n.style.fontSize }
          : {}),
      };
      if (n.runs)
        n.runs = clearRunKeys(
          n.runs,
          ['fontFamily', 'fontWeight', 'italic', 'letterSpacing'],
          n.style,
          n.text.length,
        );
    }
  });
}

function insertPairing(p: FontPairing, ab: Artboard) {
  const lang = getLang();
  const k = Math.min(ab.width, ab.height) / 1080;
  const titleSize = Math.round(96 * k),
    bodySize = Math.round(40 * k);
  const title = text(0, 0, 100, lang === 'fr' ? 'Votre titre' : 'Your heading', '#1a1a1d', {
    font: p.title.font,
    weight: p.title.weight,
    italic: p.title.italic,
    upper: p.title.upper,
    spacing: (p.title.spacing ?? 0) * titleSize,
    size: titleSize,
    align: 'center',
    name: lang === 'fr' ? 'Titre' : 'Heading',
  });
  const body = text(
    0,
    0,
    100,
    lang === 'fr' ? 'Et quelques mots pour le présenter' : 'And a few words to introduce it',
    '#1a1a1d',
    {
      font: p.body.font,
      weight: p.body.weight,
      italic: p.body.italic,
      size: bodySize,
      align: 'center',
      name: lang === 'fr' ? 'Texte' : 'Text',
    },
  );
  measureNow(title);
  measureNow(body);
  const c = boxCenter(ab);
  const gap = bodySize * 0.6;
  const total = title.height + gap + body.height;
  translateNode(title, c.x - title.width / 2, c.y - total / 2);
  translateNode(body, c.x - body.width / 2, c.y - total / 2 + title.height + gap);
  editor.apply('history.element', (d) => {
    findArtboard(d, ab.id)!.children.push(title, body);
    return [title.id, body.id];
  });
}

export const PAIRINGS = FONT_PAIRINGS;

/* ——— Redimensionnement ——— */

/**
 * Change le format du plan de travail actif en réarrangeant son contenu, ou en fait une copie au
 * nouveau format (à droite des autres plans de travail).
 */
export function resizeDesign(width: number, height: number, copy: boolean, name?: string): void {
  const doc = editor.doc;
  const ab = activeArtboard(doc);
  if (!ab) return;
  if (copy) {
    const right = Math.max(...doc.artboards.map((a) => a.x + a.width));
    const dup: Artboard = {
      ...structuredClone(ab),
      id: newId('ab'),
      name: name ?? `${ab.name} (${width} × ${height})`,
    };
    dup.children = dup.children.map((n) => cloneWithNewIds(n));
    const dx = right + 100 - ab.x;
    dup.x += dx;
    dup.children.forEach((n) => translateNode(n, dx, 0));
    resizeArtboard(dup, width, height);
    editor.apply('history.resize', (d) => {
      d.artboards.push(dup);
      return [];
    });
    editor.setActiveArtboard(dup.id);
  } else {
    editor.apply('history.resize', (d) => {
      resizeArtboard(findArtboard(d, ab.id)!, width, height);
    });
  }
  ui.set({ dialog: null });
  fit();
}

/* ——— Cadres photo ——— */

/** Cadre photo visé : un groupe avec masque d'écrêtage sous le point, ou le cadre sélectionné. */
export function frameTarget(doc: PoulpeDocument, at?: Vec): string | null {
  // Un objet recadré (Recadrage vectoriel) n'est pas un cadre photo : son contenu serait remplacé.
  const isFrame = (n: SceneNode) =>
    n.type === 'group' && n.clip && !n.vectorCrop && n.children.length > 0 && !n.locked;
  if (at) {
    for (let i = doc.artboards.length - 1; i >= 0; i--) {
      const ab = doc.artboards[i];
      const hits = [...walk(ab.children, ab, ab)].filter((l) => {
        const n = l.node;
        if (!isFrame(n) || n.type !== 'group') return false;
        const m = nodeBounds(n.children[0]);
        return at.x >= m.x && at.x <= m.x + m.width && at.y >= m.y && at.y <= m.y + m.height;
      });
      if (hits.length) return hits[hits.length - 1].node.id;
    }
    return null;
  }
  const sel = editor.selection;
  if (sel.length === 1) {
    const n = findNode(doc, sel[0])?.node;
    if (n && isFrame(n)) return n.id;
  }
  return null;
}

/**
 * Place une image dans un cadre : elle prend l'ajustement du cadre (par défaut, elle couvre la forme
 * du masque, centrée, sans déformation). Le cadre devient un cadre d'image (voir frames.ts).
 */
export function fillFrame(
  frameId: string,
  assetId: string,
  imgW: number,
  imgH: number,
  d: PoulpeDocument,
): string | null {
  const g = findNode(d, frameId)?.node;
  if (!g || g.type !== 'group') return null;
  const m = g.children[0];
  const image = createImage({
    x: m.x,
    y: m.y,
    width: m.width,
    height: m.height,
    assetId,
    name: t('name.image'),
  });
  putImageInFrame(g, image, { width: imgW, height: imgH });
  return g.id;
}
