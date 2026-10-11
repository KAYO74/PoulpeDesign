import {
  applyBoolean,
  applyOffset,
  applyOutlineStroke,
  cloneWithNewIds,
  createGroup,
  defaultEffect,
  findArtboard,
  findNode,
  importSvg,
  newId,
  normalizeAngle,
  shapePath,
  topLevelIds,
  toPathNode,
  translateNode,
  scaleNode,
  type BooleanOp,
  type Effect,
  type EffectType,
  type Paint,
  type SceneNode,
  type Stroke,
  type StrokeJoin,
  pathToSvg,
  isStyled,
} from '@poulpe/core';
import { t } from './i18n';
import { editor, toast, ui } from './store';
import { textToCurves } from './textToCurves';
import { recordStep } from './macros/recorder';

/*
 * Actions du vectoriel pro : géométrie, conversion en courbes, contours et effets, texte sur
 * tracé, import SVG. Chacune passe par `editor.apply` et s'annule d'un coup.
 */

const sel = () => editor.selection;

const STROKED = isStyled;

export function canBoolean(): boolean {
  return topLevelIds(editor.doc, sel()).length >= 2;
}

export function booleanOp(op: BooleanOp): void {
  const ids = sel();
  if (topLevelIds(editor.doc, ids).length < 2) return;
  let ok = true;
  editor.apply(`history.${op}`, (d) => {
    const out = applyBoolean(d, ids, op, t('name.curve'));
    if (!out) {
      ok = false;
      return;
    }
    return out;
  });
  if (!ok) toast(t('vector.booleanUnsupported'));
}

/** Formes de la sélection (y compris dans les groupes) qui peuvent devenir des courbes. */
function convertible(n: SceneNode): boolean {
  if (n.type === 'group') return n.children.some(convertible);
  return n.type !== 'image' && n.type !== 'path';
}

export function canConvertToCurves(): boolean {
  const doc = editor.doc;
  return sel().some((id) => {
    const n = findNode(doc, id)?.node;
    return !!n && !n.locked && convertible(n);
  });
}

/** Convertit en courbes les formes et les textes sélectionnés (Ctrl+Entrée, comme dans Affinity). */
export async function convertToCurves(): Promise<void> {
  const doc = editor.doc;
  const ids = topLevelIds(doc, sel());
  // Les textes demandent leurs polices : on prépare leurs contours avant la commande.
  const texts = new Map<string, SceneNode>();
  const missing = new Set<string>();
  const collect = async (n: SceneNode) => {
    if (n.locked) return;
    if (n.type === 'group') for (const c of n.children) await collect(c);
    else if (n.type === 'text') {
      const r = await textToCurves(n, n.name, doc);
      r.missing.forEach((m) => missing.add(m));
      if (r.node) texts.set(n.id, r.node);
    }
  };
  for (const id of ids) {
    const n = findNode(doc, id)?.node;
    if (n) await collect(n);
  }
  if (missing.size) toast(t('vector.fontMissing', { fonts: [...missing].join(', ') }));
  if (editor.doc !== doc) return;
  editor.apply('history.convert', (d) => {
    const convert = (n: SceneNode): SceneNode => {
      if (n.locked) return n;
      if (n.type === 'group') {
        n.children = n.children.map(convert);
        return n;
      }
      if (n.type === 'text') return texts.get(n.id) ?? n;
      return toPathNode(n) ?? n;
    };
    const out: string[] = [];
    for (const id of ids) {
      const loc = findNode(d, id);
      if (!loc) continue;
      const next = convert(loc.node);
      loc.parent.children[loc.index] = next;
      out.push(next.id);
    }
    return out;
  });
}

export function outlineStroke(): void {
  const ids = sel();
  if (!ids.length) return;
  editor.apply('history.outline', (d) => {
    const out: string[] = [];
    for (const id of ids) {
      const r = applyOutlineStroke(d, id, t('name.curve'));
      if (r) out.push(r);
    }
    return out.length ? out : undefined;
  });
}

export function canOutlineStroke(): boolean {
  const doc = editor.doc;
  return sel().some((id) => {
    const n = findNode(doc, id)?.node;
    return !!n && isStyled(n) && n.type !== 'text' && n.stroke.paint.type !== 'none';
  });
}

export function offsetPath(distance: number, join: StrokeJoin): void {
  const ids = topLevelIds(editor.doc, sel());
  if (!ids.length || !distance) return;
  recordStep({ kind: 'offset', distance, join });
  let ok = false;
  editor.apply('history.offset', (d) => {
    const out: string[] = [];
    for (const id of ids) {
      const r = applyOffset(d, id, distance, join, t('name.curve'));
      if (r) out.push(r);
    }
    ok = out.length > 0;
    return out.length ? out : undefined;
  });
  if (!ok) toast(t('vector.booleanUnsupported'));
}

// ————— Contours et effets —————

export function setStroke(patch: Partial<Stroke>): void {
  if (!sel().length) {
    const d = ui.get().defaults;
    ui.set({ defaults: { ...d, stroke: { ...d.stroke, ...patch } } });
    return;
  }
  editor.apply('history.style', (d) => {
    for (const id of sel()) {
      const visit = (m: SceneNode) => {
        if (m.type === 'group') m.children.forEach(visit);
        else if (STROKED(m)) {
          const next = { ...m.stroke, ...patch };
          for (const k of Object.keys(next) as (keyof Stroke)[]) if (next[k] === undefined) delete next[k];
          m.stroke = next;
        }
      };
      const n = findNode(d, id)?.node;
      if (n) visit(n);
    }
  });
}

/** Objet dont les panneaux montrent les contours : le premier sélectionné, s'il en a. */
function strokedNode(): SceneNode | null {
  const n = sel().length ? findNode(editor.doc, sel()[0])?.node : null;
  return n && STROKED(n) ? n : null;
}

/** Contours supplémentaires de l'objet (vide s'il n'y en a pas). */
export function extraStrokes(): Stroke[] {
  const n = strokedNode();
  return n && STROKED(n) ? (n.strokes ?? []) : [];
}

/** Modifie les contours supplémentaires des objets sélectionnés. */
function updateExtras(label: string, fn: (list: Stroke[]) => Stroke[]): void {
  if (!sel().length) return;
  editor.apply(label, (d) => {
    for (const id of sel()) {
      const visit = (m: SceneNode) => {
        if (m.type === 'group') m.children.forEach(visit);
        else if (STROKED(m)) {
          const next = fn(m.strokes ?? []);
          if (next.length) m.strokes = next;
          else delete m.strokes;
        }
      };
      const n = findNode(d, id)?.node;
      if (n) visit(n);
    }
  });
}

/** Ajoute un contour sous les autres, plus large, comme une bordure doublée. */
export function addStroke(): void {
  const base = strokedNode();
  const width = base && STROKED(base) ? base.stroke.width : ui.get().defaults.stroke.width;
  const extra: Stroke = { paint: { type: 'solid', color: '#ffffff' }, width: Math.max(1, width) * 2.5 };
  updateExtras('history.addStroke', (list) => [extra, ...list]);
}

export function removeStroke(index: number): void {
  updateExtras('history.removeStroke', (list) => list.filter((_, i) => i !== index));
}

/** Modifie un contour supplémentaire. */
export function setStrokeAt(index: number, patch: Partial<Stroke>): void {
  updateExtras('history.style', (list) =>
    list.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s, ...patch };
      for (const k of Object.keys(next) as (keyof Stroke)[]) if (next[k] === undefined) delete next[k];
      return next;
    }),
  );
}

/** Active, modifie ou retire (`null`) un effet sur les objets sélectionnés. */
export function setEffect(type: EffectType, patch: Partial<Effect> | null, gesture = false): void {
  const ids = sel();
  if (!ids.length) return;
  const recipe = (d: Parameters<Parameters<typeof editor.apply>[1]>[0]) => {
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (!n || n.locked) continue;
      const list = (n.effects ?? []).filter((e) => e.type !== type);
      const cur = n.effects?.find((e) => e.type === type) ?? defaultEffect(type);
      if (patch) list.push({ ...cur, ...patch } as Effect);
      if (list.length) n.effects = list;
      else delete n.effects;
    }
  };
  if (gesture) editor.preview(recipe);
  else editor.apply('history.effects', recipe);
}

// ————— Texte sur tracé —————

/** Un texte et une forme sélectionnés : le texte suit le contour de la forme, qui disparaît. */
export function canPlaceOnPath(): boolean {
  const nodes = sel().map((id) => findNode(editor.doc, id)?.node);
  return (
    nodes.length === 2 &&
    nodes.some((n) => n?.type === 'text') &&
    nodes.some((n) => n && n.type !== 'text' && n.type !== 'image' && n.type !== 'group')
  );
}

export function placeTextOnPath(): void {
  if (!canPlaceOnPath()) return;
  const [a, b] = sel().map((id) => findNode(editor.doc, id)!.node);
  const text = a.type === 'text' ? a : b;
  const shape = a.type === 'text' ? b : a;
  editor.apply('history.textPath', (d) => {
    const tn = findNode(d, text.id)!.node;
    const sn = findNode(d, shape.id)!.node;
    if (tn.type !== 'text') return;
    const cmds = shapePath(sn);
    const align = tn.style.align === 'justify' ? 'left' : tn.style.align;
    tn.path = {
      d: pathToSvg(cmds),
      viewBox: { x: 0, y: 0, width: sn.width || 1, height: sn.height || 1 },
      // Sur une ellipse, le texte part du haut ; sinon du début du tracé selon l'alignement.
      offset: sn.type === 'ellipse' ? 0.75 : align === 'center' ? 0.5 : align === 'right' ? 1 : 0,
    };
    if (sn.type === 'ellipse') tn.style = { ...tn.style, align: 'center' };
    Object.assign(tn, { x: sn.x, y: sn.y, width: sn.width, height: sn.height, rotation: sn.rotation });
    tn.autoWidth = false;
    const loc = findNode(d, shape.id)!;
    loc.parent.children.splice(loc.index, 1);
    return [tn.id];
  });
}

export function selectedPathText(): string | null {
  const ids = sel();
  if (ids.length !== 1) return null;
  const n = findNode(editor.doc, ids[0])?.node;
  return n?.type === 'text' && n.path ? n.id : null;
}

export function removeTextFromPath(): void {
  const id = selectedPathText();
  if (!id) return;
  editor.apply('history.textPath', (d) => {
    const n = findNode(d, id)?.node;
    if (n?.type !== 'text') return;
    delete n.path;
    n.autoWidth = true;
    n.rotation = normalizeAngle(n.rotation);
  });
}

export function setTextPathOffset(offset: number, gesture = false): void {
  const id = selectedPathText();
  if (!id) return;
  const recipe = (d: Parameters<Parameters<typeof editor.apply>[1]>[0]) => {
    const n = findNode(d, id)?.node;
    if (n?.type === 'text' && n.path) n.path = { ...n.path, offset: Math.min(1, Math.max(0, offset)) };
  };
  if (gesture) editor.preview(recipe);
  else editor.apply('history.textPath', recipe);
}

// ————— Import SVG —————

/**
 * Ajoute le contenu d'un fichier SVG au plan de travail actif, en objets modifiables, centré
 * (ou posé en `at`) et réduit s'il dépasse le plan de travail. Renvoie false si le SVG est illisible.
 */
export function placeSvg(text: string, name: string, at?: { x: number; y: number }): boolean {
  const r = importSvg(text);
  if (!r || !r.nodes.length) return false;
  const doc = editor.doc;
  const ab = findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return false;
  const group =
    r.nodes.length === 1 ? cloneWithNewIds(r.nodes[0]) : createGroup(r.nodes.map(cloneWithNewIds), name);
  group.name = name;
  const k = Math.min(1, (ab.width * 0.8) / (r.width || 1), (ab.height * 0.8) / (r.height || 1));
  const cx = at?.x ?? ab.x + ab.width / 2,
    cy = at?.y ?? ab.y + ab.height / 2;
  if (k !== 1) scaleNode(group, k, k, { x: 0, y: 0 }, true);
  if (k !== 1) scaleStrokes(group, k);
  translateNode(group, cx - (r.width * k) / 2, cy - (r.height * k) / 2);
  editor.apply('history.import', (d) => {
    Object.assign(d.assets, r.assets);
    (findArtboard(d, ab.id) ?? d.artboards[0]).children.push(group);
    return [group.id];
  });
  ui.set({ tool: 'select' });
  return true;
}

function scaleStrokes(n: SceneNode, k: number): void {
  if (n.type === 'group') n.children.forEach((c) => scaleStrokes(c, k));
  else if (STROKED(n)) n.stroke = { ...n.stroke, width: n.stroke.width * k };
}

// ————— Motifs —————

/**
 * Choisit une image et la pose en motif sur la cible courante (remplissage ou contour).
 * L'image rejoint les ressources du document, comme une image placée.
 */
export async function pickPatternImage(): Promise<void> {
  const { pickFile } = await import('./io');
  const file = await pickFile(['png', 'jpg', 'jpeg', 'webp', 'gif'], 'image/*');
  if (!file) return;
  const ext = file.name.split('.').pop()!.toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const blob = new Blob([file.bytes as unknown as BlobPart], { type: mime });
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
    toast(t('file.imageError'));
    return;
  }
  const assetId = newId('img');
  const width = img.naturalWidth || 256,
    height = img.naturalHeight || 256;
  const target = ui.get().colorTarget;
  editor.apply('history.style', (d) => {
    d.assets[assetId] = { id: assetId, mime, width, height, data };
    const paint: Paint = { type: 'pattern', assetId, scale: 1, angle: 0 };
    for (const id of sel()) {
      const visit = (m: SceneNode) => {
        if (m.type === 'group') m.children.forEach(visit);
        else if (STROKED(m)) {
          if (target === 'stroke') m.stroke = { ...m.stroke, paint };
          else m.fill = paint;
        }
      };
      const n = findNode(d, id)?.node;
      if (n) visit(n);
    }
  });
}
