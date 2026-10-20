import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { t } from './i18n';
import type { PanelId } from './panels/panelLayout';
import {
  Editor,
  createDocument,
  defaultStyle,
  type Defaults,
  type PoulpeDocument,
  type EditorState,
} from '@poulpe/core';

export type ToolId =
  | 'select'
  | 'direct'
  | 'artboard'
  | 'pen'
  | 'pencil'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'text'
  | 'image'
  | 'scissors'
  | 'knife'
  | 'corner'
  | 'shapeBuilder'
  | 'hand'
  | 'zoom'
  | 'eyedropper'
  | 'gradient'
  | 'transparency'
  | 'contour'
  | 'strokeWidth'
  // Persona Photo
  | 'marqueeRect'
  | 'marqueeEllipse'
  | 'lasso'
  | 'magicWand'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'magicEraser'
  | 'clone'
  | 'dodge'
  | 'burn'
  | 'blurBrush'
  | 'sharpenBrush'
  | 'polyLasso'
  | 'quickSelect'
  | 'heal'
  | 'smudge'
  | 'liquify'
  | 'straighten'
  | 'perspective'
  // Version 1.2 : outils repris d'Affinity
  | 'roundRect'
  | 'triangle'
  | 'arrow'
  | 'callout'
  | 'donut'
  | 'pie'
  | 'cog'
  | 'cloud'
  | 'heart'
  | 'spiral'
  | 'vectorBrush'
  | 'vectorFill'
  | 'vectorCrop'
  | 'stylePicker'
  | 'frameText'
  | 'table'
  | 'pictureFrameRect'
  | 'pictureFrameEllipse'
  | 'crop'
  | 'pixelGradient'
  | 'sponge'
  | 'backgroundEraser'
  | 'floodEraser'
  | 'colorReplace'
  | 'patch'
  | 'blemish'
  | 'redEye';

/** Espaces de travail, comme les Personas d'Affinity. */
export type Persona = 'draw' | 'photo' | 'layout';

/** Combinaison d'une nouvelle sélection de pixels avec l'ancienne. */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface BrushSettings {
  /** Diamètre en pixels du document. */
  size: number;
  /** Dureté du bord, opacité et flux, de 0 à 100. */
  hardness: number;
  opacity: number;
  flow: number;
  /** Forme de pinceau (tools/brushes/tips.ts) ; absente : touche ronde. */
  tip?: string;
  /** Espacement des touches, en % de la taille (10 par défaut). */
  spacing?: number;
  /** Angle (degrés) et rondeur (%, 100 = pas aplatie) de la touche. */
  angle?: number;
  roundness?: number;
  /** Variations au hasard à chaque touche : taille (%), angle (degrés), dispersion (% de la taille). */
  sizeJitter?: number;
  angleJitter?: number;
  scatter?: number;
}

export type Side = 'left' | 'right';
export type ToolsColumns = 'auto' | 'one' | 'two';
/** Outils tous alignés, ou rangés en groupes (un bouton par famille, ses variantes dans un menu). */
export type ToolsLayout = 'all' | 'groups';
export type Theme = 'dark' | 'light';
export type Dialog =
  | null
  | 'new'
  | 'export'
  | 'shortcuts'
  | 'about'
  | 'draft'
  | 'resize'
  | 'offset'
  | 'filter'
  | 'selectionModify'
  | 'document'
  | 'batch'
  | 'vectorize'
  | 'extensions'
  | 'extensionParams'
  | 'imageSize'
  | 'canvasSize'
  | 'workspace'
  | 'preferences'
  | 'help'
  | 'saveTemplate'
  | 'language';

/** Catégories de la fenêtre Préférences. */
export type PrefsTab =
  'general' | 'performance' | 'display' | 'layers' | 'shortcuts' | 'advanced' | 'diagnostic';
/** Rubriques de l'aide intégrée. */
export type HelpTab = 'start' | 'faq' | 'performance';

export interface Settings {
  theme: Theme;
  toolsSide: Side;
  /** Disposition de la colonne d'outils : automatique (deux colonnes s'il y a beaucoup d'outils), une ou deux colonnes. */
  toolsColumns: ToolsColumns;
  /** Outils tous visibles l'un sous l'autre, ou rangés en groupes comme dans Photoshop et Affinity. */
  toolsLayout: ToolsLayout;
  /** Colonne d'outils verrouillée : elle ne se détache plus en palette flottante. */
  toolsLocked: boolean;
  studioSide: Side;
  rulers: boolean;
  grid: boolean;
  snapping: boolean;
  /** Panneau Bibliothèque (modèles, éléments, styles) ouvert. */
  library: boolean;
  /** Afficher l'écran d'accueil (nouveau document, modèles) au lancement. */
  showWelcome: boolean;
  /** Appli de bureau : chercher les mises à jour au lancement. */
  autoUpdate: boolean;
  /** Images par seconde et mémoire utilisée dans la barre d'état. */
  perfMeter: boolean;
  /** Taille de l'interface (1 = 100 %), appli de bureau. */
  uiScale: number;
  /** Forme du sélecteur du panneau Couleur : carré, roue avec carré, ou roue avec triangle. */
  colorShape: ColorShape;
}

export type ColorShape = 'box' | 'wheel' | 'triangle';

export interface View {
  zoom: number;
  /** Position à l'écran (pixels CSS) de l'origine du document. */
  panX: number;
  panY: number;
}

export interface UiState {
  persona: Persona;
  tool: ToolId;
  view: View;
  settings: Settings;
  /** Style appliqué aux nouveaux objets. */
  defaults: Defaults & { cornerRadius: number; sides: number; points: number; innerRatio: number };
  /** Cible des panneaux de couleur. */
  colorTarget: 'fill' | 'stroke';
  recentColors: string[];
  editingTextId: string | null;
  /** Image en cours de recadrage. */
  cropId: string | null;
  /** Nœuds sélectionnés (« sous-tracé:nœud ») du tracé édité avec l'outil Nœud. */
  nodeSelection: string[];
  /**
   * Options de l'outil Nœud : cadre de transformation des nœuds, aimantation sur les autres nœuds,
   * aimantation de construction des poignées, sens du tracé.
   */
  nodeOptions: { transform: boolean; alignNodes: boolean; snapHandles: boolean; orientation: boolean };
  /** Lissage du crayon, de 0 à 100. */
  pencilSmoothing: number;
  /** Réglages des pinceaux, par outil (pinceau, gomme, tampon…). */
  brushes: Partial<Record<ToolId, BrushSettings>>;
  /** Couleurs de peinture de la Persona Photo : principale et secondaire. */
  brushColor: string;
  brushColor2: string;
  selectionMode: SelectionMode;
  /** Adoucissement des nouvelles sélections, en pixels du document. */
  feather: number;
  /** Baguette magique et pot de peinture : tolérance (0 à 255) et zone contiguë. */
  tolerance: number;
  contiguous: boolean;
  /** Une sélection de pixels est active. */
  hasPixelSelection: boolean;
  /** Le pinceau peint dans le masque de ce calque plutôt que dans ses pixels. */
  maskEditId: string | null;
  /** Filtre ouvert dans la boîte de dialogue Filtres. */
  filterKind: import('@poulpe/core').AdjustmentKind | null;
  /** Modification de sélection demandée (adoucir, agrandir, réduire). */
  selectionModify: 'feather' | 'grow' | 'shrink' | null;
  /** Fluidité : pousser, tourbillon, gonfler ou pincer. */
  liquifyMode: import('@poulpe/core').LiquifyMode;
  /** Redressement : agrandir le calque pour cacher les coins vides. */
  straightenFill: boolean;
  /** Calque dont on corrige la perspective (outil Perspective). */
  perspectiveId: string | null;
  /** Calcul long en cours (gomme magique) : avancement de 0 à 1. */
  busy: { label: string; progress: number } | null;
  /** Cadre de texte dont on choisit le cadre suivant (après un clic sur son indicateur de débordement). */
  linkFrom: string | null;
  /** Épreuvage CMJN à l'écran. */
  softProof: boolean;
  /** Fichier courant : chemin (bureau) ou nom (navigateur). */
  filePath: string | null;
  dialog: Dialog;
  /**
   * Petite fenêtre « nouvelle version disponible » : elle s'affiche par-dessus les autres fenêtres
   * (écran d'accueil compris), pour qu'une mise à jour trouvée au démarrage soit toujours proposée.
   */
  updateOpen: boolean;
  toast: string | null;
  cursor: { x: number; y: number } | null;
  /** Panneau glissé au-dessus de sa zone d'ancrage (surbrillance du point de chute). */
  panelDock: PanelId | null;
  /** Espace de travail modifié dans la boîte « Espace de travail » (null : nouvel espace). */
  workspaceEdit: string | null;
  prefsTab: PrefsTab;
  helpTab: HelpTab;
}

const SETTINGS_KEY = 'poulpe.settings';

function loadSettings(): Settings {
  const fallback: Settings = {
    theme: 'dark',
    toolsSide: 'right',
    toolsColumns: 'auto',
    toolsLayout: 'all',
    toolsLocked: false,
    studioSide: 'right',
    rulers: true,
    grid: false,
    snapping: true,
    library: true,
    showWelcome: true,
    autoUpdate: true,
    perfMeter: false,
    uiScale: 1,
    colorShape: 'box',
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

/** Petit magasin d'état observable, lu par React via `useSyncExternalStore`. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = () => this.state;
  set = (patch: Partial<T> | ((s: T) => Partial<T>)) => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function starterDocument(): PoulpeDocument {
  const doc = createDocument({ name: t('app.untitled'), width: 1080, height: 1350 });
  doc.artboards[0].name = t('name.artboard', { n: 1 });
  return doc;
}

export const editor = new Editor(starterDocument());

export const ui = new Store<UiState>({
  persona: 'draw',
  tool: 'select',
  view: { zoom: 0.5, panX: 100, panY: 60 },
  settings: loadSettings(),
  defaults: { ...defaultStyle(), cornerRadius: 0, sides: 6, points: 5, innerRatio: 0.5 },
  colorTarget: 'fill',
  recentColors: [],
  editingTextId: null,
  cropId: null,
  nodeSelection: [],
  nodeOptions: { transform: false, alignNodes: true, snapHandles: true, orientation: true },
  pencilSmoothing: 50,
  brushes: {},
  brushColor: '#1a1a1d',
  brushColor2: '#ffffff',
  selectionMode: 'replace',
  feather: 0,
  tolerance: 32,
  contiguous: true,
  hasPixelSelection: false,
  maskEditId: null,
  filterKind: null,
  selectionModify: null,
  liquifyMode: 'push',
  straightenFill: true,
  perspectiveId: null,
  busy: null,
  linkFrom: null,
  softProof: false,
  filePath: null,
  dialog: null,
  updateOpen: false,
  toast: null,
  cursor: null,
  panelDock: null,
  workspaceEdit: null,
  prefsTab: 'general',
  helpTab: 'start',
});

export function setSettings(patch: Partial<Settings>): void {
  const settings = { ...ui.get().settings, ...patch };
  ui.set({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible */
  }
}

export function pushRecentColor(color: string): void {
  const list = [color, ...ui.get().recentColors.filter((c) => c !== color)].slice(0, 12);
  ui.set({ recentColors: list });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  ui.set({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.set({ toast: null }), 3500);
}

export function useEditor(): EditorState {
  return useSyncExternalStore(editor.subscribe, editor.getState);
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(ui.get()));
}

/** Lit un petit magasin d'état (réglages propres à un outil) dans un composant React. */
export function useStore<S, T>(store: Store<S>, select: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

const BRUSH_DEFAULTS: Partial<Record<ToolId, BrushSettings>> = {
  brush: { size: 24, hardness: 80, opacity: 100, flow: 100 },
  eraser: { size: 40, hardness: 80, opacity: 100, flow: 100 },
  magicEraser: { size: 36, hardness: 100, opacity: 100, flow: 100 },
  clone: { size: 40, hardness: 50, opacity: 100, flow: 100 },
  dodge: { size: 60, hardness: 20, opacity: 50, flow: 40 },
  burn: { size: 60, hardness: 20, opacity: 50, flow: 40 },
  blurBrush: { size: 50, hardness: 30, opacity: 100, flow: 50 },
  sharpenBrush: { size: 50, hardness: 30, opacity: 60, flow: 50 },
  quickSelect: { size: 30, hardness: 100, opacity: 100, flow: 100 },
  heal: { size: 40, hardness: 50, opacity: 100, flow: 100 },
  smudge: { size: 40, hardness: 40, opacity: 60, flow: 100 },
  liquify: { size: 120, hardness: 0, opacity: 50, flow: 100 },
  // Version 1.2 (tools/pixel)
  sponge: { size: 60, hardness: 20, opacity: 50, flow: 40 },
  backgroundEraser: { size: 60, hardness: 80, opacity: 100, flow: 100 },
  colorReplace: { size: 40, hardness: 60, opacity: 100, flow: 100 },
  blemish: { size: 24, hardness: 50, opacity: 100, flow: 100 },
  redEye: { size: 40, hardness: 100, opacity: 100, flow: 100 },
};

/** Réglages du pinceau de l'outil (ceux du pinceau par défaut pour les autres outils). */
export function brushSettings(tool: ToolId = ui.get().tool): BrushSettings {
  return ui.get().brushes[tool] ?? BRUSH_DEFAULTS[tool] ?? BRUSH_DEFAULTS.brush!;
}

export function setBrush(patch: Partial<BrushSettings>, tool: ToolId = ui.get().tool): void {
  ui.set((s) => ({ brushes: { ...s.brushes, [tool]: { ...brushSettings(tool), ...patch } } }));
}

export function isBrushTool(tool: ToolId): boolean {
  return tool in BRUSH_DEFAULTS;
}

export function setTool(tool: ToolId): void {
  if (ui.get().tool !== tool) window.dispatchEvent(new Event('poulpe:toolchange'));
  ui.set({ tool, editingTextId: null, cropId: null, nodeSelection: [], perspectiveId: null });
}

/** Redessine le composant quand la sélection dans le texte édité change. */
export function useTextSelection(): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener('poulpe:textselection', bump);
    return () => window.removeEventListener('poulpe:textselection', bump);
  }, []);
}
