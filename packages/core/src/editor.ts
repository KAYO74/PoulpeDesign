import { produce, freeze, setAutoFreeze } from 'immer';
import { createDocument } from './factory';
import { allNodeIds, findNode, fitGroups } from './tree';
import type { PoulpeDocument } from './types';

setAutoFreeze(true);

export interface HistoryEntry {
  /** Clé de traduction décrivant l'action, par ex. `history.move`. */
  label: string;
  doc: PoulpeDocument;
  selection: string[];
  /** État hors document gardé avec l'historique (la sélection de pixels de l'interface). */
  extra?: unknown;
}

/** État complet de l'éditeur, opaque pour l'interface (voir `Editor.snapshot`). */
export interface EditorSnapshot {
  readonly past: HistoryEntry[];
  readonly future: HistoryEntry[];
  readonly label: string;
  readonly savedDoc: PoulpeDocument | null;
  readonly doc: PoulpeDocument;
  readonly selection: string[];
  readonly activeArtboardId: string;
}

/** Lecture et restauration d'un état hors document qui suit l'historique (voir `setExtraState`). */
export interface ExtraState {
  get(): unknown;
  set(value: unknown): void;
}

export interface EditorState {
  doc: PoulpeDocument;
  selection: string[];
  /** Plan de travail actif : celui où arrivent les nouveaux objets quand on ne vise aucun plan. */
  activeArtboardId: string;
  /** Vrai si le document a changé depuis le dernier enregistrement. */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Libellés de l'historique, du plus ancien au plus récent ; `historyIndex` pointe l'état courant. */
  history: string[];
  historyIndex: number;
}

type Recipe = (draft: PoulpeDocument) => void | string[];

/**
 * Le cœur de l'éditeur : tout changement passe par une commande (`apply`) ou par un geste
 * (`begin` / `preview` / `commit`), ce qui rend l'annulation fiable. Les documents sont immuables
 * (immer) : l'historique ne garde que des références, pas des copies. Sa longueur est limitée
 * par `setHistoryLimit` (Préférences > Performances), illimitée par défaut.
 */
export class Editor {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  /**
   * Geste en cours. `transient` : aperçu passager (rotation du Recadrage de la Persona Photo),
   * qu'une autre commande n'enregistre pas : elle s'applique dessous, puis l'aperçu est remontré.
   */
  private gesture: { base: PoulpeDocument; selection: string[]; transient?: Recipe } | null = null;
  /** Aperçu passager mis de côté pendant un autre geste, remontré à sa fin. */
  private held: Recipe | null = null;
  private savedDoc: PoulpeDocument | null;
  private listeners = new Set<() => void>();
  private state: EditorState;
  private currentLabel = 'history.open';
  /**
   * Passe exécutée après chaque commande, dans le même brouillon : l'interface s'en sert pour
   * recalculer la taille des textes, qui dépend des polices du navigateur.
   */
  private normalizer: ((draft: PoulpeDocument) => void) | null = null;
  private extra: ExtraState | null = null;
  private historyLimit = Infinity;
  /** Libellés de l'historique déjà calculés, réutilisés tant que l'historique ne change pas. */
  private labels: { key: unknown[]; list: string[] } | null = null;

  constructor(doc: PoulpeDocument = createDocument()) {
    const frozen = freeze(doc, true);
    this.savedDoc = frozen;
    this.state = this.makeState(frozen, [], doc.artboards[0]?.id ?? '');
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EditorState => this.state;

  get doc(): PoulpeDocument {
    return this.state.doc;
  }

  get selection(): string[] {
    return this.state.selection;
  }

  private makeState(doc: PoulpeDocument, selection: string[], activeArtboardId: string): EditorState {
    const active = doc.artboards.some((a) => a.id === activeArtboardId)
      ? activeArtboardId
      : (doc.artboards[0]?.id ?? '');
    return {
      doc,
      selection,
      activeArtboardId: active,
      dirty: doc !== this.savedDoc,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      history: this.historyLabels(),
      historyIndex: this.past.length,
    };
  }

  /**
   * Libellés de l'historique. Pendant un geste, l'état change à chaque image sans que
   * l'historique change : la liste est alors réutilisée au lieu d'être recopiée.
   */
  private historyLabels(): string[] {
    const key = [
      this.past.length,
      this.past.at(-1),
      this.past[0],
      this.future.length,
      this.future.at(-1),
      this.currentLabel,
    ];
    const hit = this.labels;
    if (hit && hit.key.every((v, i) => v === key[i])) return hit.list;
    const list = [
      ...this.past.map((e) => e.label),
      this.currentLabel,
      ...[...this.future].reverse().map((e) => e.label),
    ];
    this.labels = { key, list };
    return list;
  }

  private set(doc: PoulpeDocument, selection: string[], activeArtboardId = this.state.activeArtboardId) {
    this.assign(doc, selection, activeArtboardId);
    this.notify();
  }

  /** Change l'état sans prévenir (voir `set`). */
  private assign(doc: PoulpeDocument, selection: string[], activeArtboardId = this.state.activeArtboardId) {
    const valid = new Set(allNodeIds(doc));
    this.state = this.makeState(
      doc,
      selection.filter((id) => valid.has(id)),
      activeArtboardId,
    );
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /** Retire sans prévenir l'aperçu passager en cours (l'état revient à sa base) ; renvoie sa recette. */
  private lift(): Recipe | null {
    const g = this.gesture;
    if (!g?.transient) return null;
    this.gesture = null;
    this.assign(g.base, g.selection);
    return g.transient;
  }

  /** Termine le geste en cours avant une commande ; renvoie l'aperçu passager retiré (voir `lift`). */
  private settle(label: string): Recipe | null {
    const transient = this.lift();
    if (!this.gesture) return transient;
    this.commit(label);
    return this.lift();
  }

  /** Remontre un aperçu passager par-dessus l'état courant, sans prévenir. */
  private reopen(recipe: Recipe | null) {
    if (!recipe) return;
    this.gesture = { base: this.state.doc, selection: this.state.selection, transient: recipe };
    const { doc, selection } = this.run(this.state.doc, recipe);
    this.assign(doc, selection ?? this.state.selection);
  }

  private run(base: PoulpeDocument, recipe: Recipe): { doc: PoulpeDocument; selection?: string[] } {
    let selection: string[] | undefined;
    const doc = produce(base, (draft) => {
      const r = recipe(draft);
      if (Array.isArray(r)) selection = r;
      this.normalizer?.(draft);
      fitGroups(draft);
    });
    return { doc, selection };
  }

  /**
   * Applique une commande annulable. La recette modifie le brouillon ; si elle renvoie
   * une liste d'ids, celle-ci devient la nouvelle sélection.
   */
  apply(label: string, recipe: Recipe): void {
    const transient = this.settle(label);
    const { doc, selection } = this.run(this.state.doc, recipe);
    if (doc === this.state.doc && !selection && !transient) return;
    if (doc !== this.state.doc) this.push(label);
    this.assign(doc, selection ?? this.state.selection);
    this.reopen(transient);
    this.notify();
  }

  private push(label: string) {
    this.past.push({
      label: this.currentLabel,
      doc: this.state.doc,
      selection: this.state.selection,
      extra: this.extra?.get(),
    });
    this.future = [];
    this.currentLabel = label;
    this.trim();
  }

  /** Début d'un geste (glisser, redimensionner…) : les aperçus partent tous de cet état. */
  begin(): void {
    const transient = this.lift();
    if (transient) this.held = transient;
    this.gesture = { base: this.state.doc, selection: this.state.selection };
  }

  get inGesture(): boolean {
    return this.gesture !== null;
  }

  /**
   * Aperçu pendant un geste, sans entrée d'historique. `transient` : aperçu passager, qui reste
   * affiché quand une autre commande passe (elle s'applique dessous, sans l'enregistrer) ; seuls
   * `commit` et `cancel` le terminent.
   */
  preview(recipe: Recipe, opts: { transient?: boolean } = {}): void {
    if (opts.transient) {
      if (!this.gesture) this.begin();
      this.gesture!.transient = recipe;
    } else if (!this.gesture || this.gesture.transient) this.begin();
    const { doc, selection } = this.run(this.gesture!.base, recipe);
    this.set(doc, selection ?? this.state.selection);
  }

  /** Fin du geste : une seule entrée d'historique pour tout le geste. */
  commit(label: string): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    const held = g.transient ? null : this.held;
    this.held = null;
    if (this.state.doc === g.base && !held) return;
    if (this.state.doc !== g.base) {
      this.past.push({
        label: this.currentLabel,
        doc: g.base,
        selection: g.selection,
        extra: this.extra?.get(),
      });
      this.future = [];
      this.currentLabel = label;
      this.trim();
    }
    this.assign(this.state.doc, this.state.selection);
    this.reopen(held);
    this.notify();
  }

  cancel(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    const held = g.transient ? null : this.held;
    this.held = null;
    this.assign(g.base, g.selection);
    this.reopen(held);
    this.notify();
  }

  undo(): void {
    // Pendant un aperçu passager (même mis de côté), Annuler retire seulement l'aperçu.
    const transient = !!this.gesture?.transient || !!this.held;
    this.held = null;
    if (this.gesture) this.cancel();
    if (transient) return;
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push({
      label: this.currentLabel,
      doc: this.state.doc,
      selection: this.state.selection,
      extra: this.extra?.get(),
    });
    this.currentLabel = prev.label;
    this.extra?.set(prev.extra);
    this.set(prev.doc, prev.selection);
  }

  redo(): void {
    // Un geste en cours n'est pas enregistré par le rétablissement : il est annulé.
    this.held = null;
    if (this.gesture) this.cancel();
    const next = this.future.pop();
    if (!next) return;
    this.past.push({
      label: this.currentLabel,
      doc: this.state.doc,
      selection: this.state.selection,
      extra: this.extra?.get(),
    });
    this.currentLabel = next.label;
    this.extra?.set(next.extra);
    this.set(next.doc, next.selection);
  }

  /** Revient à un point de l'historique (panneau Historique). */
  goTo(index: number): void {
    while (this.past.length > index && this.past.length) this.undo();
    while (this.past.length < index && this.future.length) this.redo();
  }

  /**
   * État hors document qui suit l'historique : `get` est lu à chaque étape enregistrée, `set`
   * le restaure à l'annulation et au rétablissement.
   */
  setExtraState(extra: ExtraState | null): void {
    this.extra = extra;
  }

  /**
   * Enregistre une étape d'historique qui ne change que l'état hors document (une nouvelle
   * sélection de pixels, par exemple). `before` : cet état juste avant le changement.
   */
  mark(label: string, before: unknown): void {
    const transient = this.settle(label);
    this.past.push({
      label: this.currentLabel,
      doc: this.state.doc,
      selection: this.state.selection,
      extra: before,
    });
    this.future = [];
    this.currentLabel = label;
    this.trim();
    this.assign(this.state.doc, this.state.selection);
    this.reopen(transient);
    this.notify();
  }

  /**
   * Nombre maximal d'étapes d'annulation gardées (0 ou moins : illimité). Les plus anciennes sont
   * oubliées, ce qui libère la mémoire des images qu'elles étaient seules à retenir.
   */
  setHistoryLimit(limit: number): void {
    this.historyLimit = limit > 0 ? Math.floor(limit) : Infinity;
    if (this.trim()) this.set(this.state.doc, this.state.selection);
  }

  /** Oublie les plus anciennes étapes pour n'en garder que `keep` (manque de mémoire). */
  dropOldHistory(keep: number): void {
    const drop = this.past.length - Math.max(0, Math.floor(keep));
    if (drop <= 0) return;
    this.past.splice(0, drop);
    this.set(this.state.doc, this.state.selection);
  }

  private trim(): boolean {
    const drop = this.past.length - this.historyLimit;
    if (drop <= 0) return false;
    this.past.splice(0, drop);
    return true;
  }

  /** Copie de l'état complet (document, historique), pour le remettre tel quel avec `restore`. */
  snapshot(): EditorSnapshot {
    this.held = null;
    if (this.gesture) this.cancel();
    return {
      past: [...this.past],
      future: [...this.future],
      label: this.currentLabel,
      savedDoc: this.savedDoc,
      doc: this.state.doc,
      selection: this.state.selection,
      activeArtboardId: this.state.activeArtboardId,
    };
  }

  restore(s: EditorSnapshot): void {
    this.gesture = null;
    this.held = null;
    this.past = [...s.past];
    this.future = [...s.future];
    this.currentLabel = s.label;
    this.savedDoc = s.savedDoc;
    this.set(s.doc, s.selection, s.activeArtboardId);
  }

  select(ids: string[]): void {
    const doc = this.state.doc;
    const first = ids.length ? findNode(doc, ids[0]) : null;
    this.set(doc, ids, first?.artboard.id ?? this.state.activeArtboardId);
  }

  setActiveArtboard(id: string): void {
    this.set(this.state.doc, this.state.selection, id);
  }

  /**
   * Remplace le document (ouverture d'un fichier) et vide l'historique. `unsaved` : le document
   * n'existe pas sur le disque tel quel (brouillon récupéré).
   */
  load(doc: PoulpeDocument, opts: { unsaved?: boolean } = {}): void {
    this.past = [];
    this.future = [];
    this.gesture = null;
    this.held = null;
    this.currentLabel = 'history.open';
    const frozen = freeze(doc, true);
    this.savedDoc = opts.unsaved ? null : frozen;
    this.set(frozen, [], frozen.artboards[0]?.id ?? '');
    this.normalizeNow();
  }

  setNormalizer(fn: ((draft: PoulpeDocument) => void) | null): void {
    this.normalizer = fn;
    this.normalizeNow();
  }

  /**
   * Réapplique la normalisation au document courant sans créer d'entrée d'historique
   * (par exemple quand une police finit de charger et que les textes changent de taille).
   */
  normalizeNow(): void {
    if (!this.normalizer) return;
    const base = this.state.doc;
    const doc = produce(base, (draft) => {
      this.normalizer!(draft);
      fitGroups(draft);
    });
    if (doc === base) return;
    if (base === this.savedDoc) this.savedDoc = doc;
    if (this.gesture) this.gesture.base = produce(this.gesture.base, (d) => void this.normalizer!(d));
    this.set(doc, this.state.selection);
  }

  markSaved(): void {
    this.savedDoc = this.state.doc;
    this.set(this.state.doc, this.state.selection);
  }
}
