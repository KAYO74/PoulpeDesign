/**
 * Modèle de document Poulpe (format `.poulpe`, version 7).
 *
 * Toutes les coordonnées sont en pixels, dans l'espace du document (« monde ») :
 * les objets d'un plan de travail ne sont pas relatifs à ce plan de travail.
 * Un objet est une boîte (x, y, width, height) tournée de `rotation` degrés autour de son centre.
 */

/** Couleur CSS hexadécimale : `#rrggbb` ou `#rrggbbaa`. */
export type Color = string;

export interface GradientStop {
  /** Position de 0 à 1. */
  offset: number;
  color: Color;
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: Color }
  /** `angle` en degrés : 0 = de gauche à droite, 90 = de haut en bas. */
  | { type: 'linear'; stops: GradientStop[]; angle: number }
  /** Centre et rayon en fractions de la boîte de l'objet. */
  | { type: 'radial'; stops: GradientStop[]; cx: number; cy: number; r: number }
  /**
   * Dégradé conique (angulaire) : les couleurs tournent autour du centre. `angle` en degrés
   * donne la direction du début du dégradé, le centre est en fractions de la boîte.
   */
  | { type: 'conic'; stops: GradientStop[]; angle: number; cx: number; cy: number }
  /** Motif : une image répétée. `scale` de la tuile, `angle` en degrés. */
  | { type: 'pattern'; assetId: string; scale: number; angle: number };

/** Peintures faites de couleurs échelonnées (dégradés). */
export type GradientPaint = Extract<Paint, { stops: GradientStop[] }>;

export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';
/** Extrémités décoratives d'un tracé ouvert. */
export type ArrowHead = 'none' | 'triangle' | 'arrow' | 'circle' | 'square' | 'bar';

/**
 * Largeur variable d'un contour : multiplicateurs de l'épaisseur le long du tracé, du début
 * (0) à la fin (1). Deux valeurs au minimum ; interpolées en douceur entre elles.
 */
export type WidthProfile = number[];

export interface Stroke {
  paint: Paint;
  width: number;
  /** Position du trait par rapport au tracé (`center` si absent). */
  align?: 'center' | 'inside' | 'outside';
  /** Largeur variable (pinceau calligraphique) : absente = épaisseur constante. */
  profile?: WidthProfile;
  /** Extrémités des traits (`round` si absent). */
  cap?: StrokeCap;
  /** Jonctions des traits (`round` si absent). */
  join?: StrokeJoin;
  /** Pointillés : longueurs alternées trait / espace, en multiples de l'épaisseur. Absent : trait plein. */
  dash?: number[];
  /** Flèche au début et à la fin d'un tracé ouvert. */
  start?: ArrowHead;
  end?: ArrowHead;
}

/** Ombre portée (sous l'objet) ou ombre interne. Décalage et flou en pixels. */
export interface ShadowEffect {
  type: 'dropShadow' | 'innerShadow';
  enabled: boolean;
  color: Color;
  x: number;
  y: number;
  blur: number;
}

/** Lueur externe ou interne. */
export interface GlowEffect {
  type: 'outerGlow' | 'innerGlow';
  enabled: boolean;
  color: Color;
  blur: number;
}

/**
 * Biseau et estampage : un relief simulé par une lumière venant de `angle` degrés. `depth` en
 * pixels, `softness` adoucit l'arête, `intensity` de 0 à 100 dose les lumières et les ombres.
 */
export interface BevelEffect {
  type: 'bevel';
  enabled: boolean;
  /** `bevel` : relief vers l'extérieur ; `emboss` : relief vers l'intérieur. */
  style: 'bevel' | 'emboss';
  angle: number;
  depth: number;
  softness: number;
  intensity: number;
  light: Color;
  shadow: Color;
}

/** Flou gaussien de l'objet lui-même. */
export interface BlurEffect {
  type: 'blur';
  enabled: boolean;
  radius: number;
}

export type Effect = ShadowEffect | GlowEffect | BlurEffect | BevelEffect;
export type EffectType = Effect['type'];

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

interface NodeBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrés, sens horaire, autour du centre de la boîte. */
  rotation: number;
  /** 0 à 1. */
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  /** Effets de calque (au plus un de chaque type). */
  effects?: Effect[];
  /** Masque de calque : ce qui est opaque dans le masque reste visible, le reste est caché. */
  mask?: LayerMask;
}

/**
 * Masque de calque : une image dont seule l'opacité compte (opaque = visible, transparent =
 * caché), étirée sur la boîte de l'objet comme une image.
 */
export interface LayerMask {
  assetId: string;
  enabled: boolean;
}

interface Styled {
  fill: Paint;
  stroke: Stroke;
  /** Contours supplémentaires, dessinés sous `stroke` (du plus large au plus fin, comme Illustrator). */
  strokes?: Stroke[];
}

export interface RectNode extends NodeBase, Styled {
  type: 'rect';
  cornerRadius: number;
}

export interface EllipseNode extends NodeBase, Styled {
  type: 'ellipse';
}

export interface PolygonNode extends NodeBase, Styled {
  type: 'polygon';
  sides: number;
}

export interface StarNode extends NodeBase, Styled {
  type: 'star';
  points: number;
  /** Rayon intérieur / rayon extérieur, de 0.05 à 1. */
  innerRatio: number;
}

export interface LineNode extends NodeBase, Styled {
  type: 'line';
  /** 1 : du coin haut gauche au coin bas droit ; -1 : du coin bas gauche au coin haut droit. */
  direction: 1 | -1;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Réglages de colonnes d'un bloc ou d'un cadre de texte. */
export interface TextColumns {
  count: number;
  /** Gouttière entre les colonnes, en pixels. */
  gap: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
  /** Multiplicateur de la taille de police. */
  lineHeight: number;
  /** Interlettrage en pixels. */
  letterSpacing: number;
  underline: boolean;
  strike: boolean;
  uppercase: boolean;
  /**
   * Fonctions OpenType actives (`liga`, `dlig`, `smcp`, `onum`, `ss01`…). Absent : les réglages
   * par défaut de la police.
   */
  features?: string[];
  /** Colonnes du bloc de texte. Absent ou `count` à 1 : une seule colonne. */
  columns?: TextColumns;
}

/** Réglages de caractère qui peuvent varier à l'intérieur d'un même texte. */
export interface RunStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  letterSpacing?: number;
  /** Couleur unie qui remplace le remplissage du texte. */
  color?: Color;
}

/** Plage de caractères `[start, end)` (indices UTF-16 dans `text`) et ce qui la distingue du style du texte. */
export interface TextRun {
  start: number;
  end: number;
  style: RunStyle;
}

export interface TextNode extends NodeBase, Styled {
  type: 'text';
  text: string;
  /** Style du texte entier (paragraphe et caractères). */
  style: TextStyle;
  /** Styles par caractère, triés et sans chevauchement. Absent : tout le texte suit `style`. */
  runs?: TextRun[];
  /** Texte artistique : la largeur suit le texte. Sinon bloc de texte : le texte passe à la ligne. */
  autoWidth: boolean;
  /** Texte sur tracé : le texte suit cette courbe, sur une seule ligne. */
  path?: TextPath;
  /**
   * Cadre de texte (mise en page) : la boîte garde sa hauteur, le texte qui ne tient pas déborde
   * dans le cadre suivant (`next`) ou reste caché.
   */
  frame?: boolean;
  /**
   * Cadre suivant d'un texte lié. Le premier cadre de la chaîne porte le texte et son style ; les
   * suivants affichent la suite et leur propre `text` est ignoré.
   */
  next?: string;
}

/** Courbe suivie par un texte, exprimée dans `viewBox` et étirée sur la boîte du texte. */
export interface TextPath {
  d: string;
  viewBox: { x: number; y: number; width: number; height: number };
  /**
   * Position du texte le long de la courbe, de 0 (début) à 1 (fin) : début du texte aligné à
   * gauche, milieu d'un texte centré, fin d'un texte aligné à droite.
   */
  offset: number;
}

/**
 * Tracé libre (icônes, formes de la bibliothèque) : données de tracé SVG exprimées dans `viewBox`,
 * étirées pour remplir la boîte de l'objet.
 */
export interface PathNode extends NodeBase, Styled {
  type: 'path';
  /** Attribut `d` d'un tracé SVG. */
  d: string;
  /** Repère des données `d` : ce rectangle est ramené sur la boîte de l'objet. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Règle de remplissage des tracés qui se recoupent (`nonzero` par défaut). */
  fillRule?: 'nonzero' | 'evenodd';
  /** Nœuds intelligents (outil Nœud), repérés par leur position dans le repère `d`. */
  smartNodes?: { x: number; y: number }[];
}

/** Rectangle en fractions (0 à 1) de l'image source. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageNode extends NodeBase {
  type: 'image';
  assetId: string;
  /** Partie de l'image affichée dans la boîte de l'objet. Absent : l'image entière. */
  crop?: Crop;
}

/**
 * Instance de symbole : affiche le contenu du symbole `symbolId` du document, ramené dans la
 * boîte de l'objet. Modifier le symbole met à jour toutes ses instances.
 */
export interface SymbolNode extends NodeBase {
  type: 'symbol';
  symbolId: string;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  /** Du dessous vers le dessus. */
  children: SceneNode[];
  /** Masque d'écrêtage : l'objet du dessous découpe les autres. */
  clip: boolean;
  /** Cadre d'image (avec `clip`) : la forme du dessous est le cadre, l'image suit son ajustement. */
  picture?: PictureFrame;
  /** Tableau : les enfants sont ses cellules (voir `TableInfo`). */
  table?: TableInfo;
}

/**
 * Ajustement de l'image dans un cadre d'image, comme dans Affinity Publisher : `fill` couvre le
 * cadre (le surplus est caché), `fit` montre l'image entière, `stretch` la déforme pour remplir le
 * cadre, `none` garde sa taille.
 */
export type FrameFit = 'fill' | 'fit' | 'stretch' | 'none';

/**
 * Cadre d'image : un groupe à masque d'écrêtage dont le premier enfant (rectangle, ellipse…) est
 * le cadre et le suivant l'image. Sans image, le cadre est vide. L'ajustement se réapplique quand
 * le cadre change de taille ; le zoom et le décalage de l'image se lisent dans sa position.
 */
export interface PictureFrame {
  fit: FrameFit;
}

/**
 * Tableau : un groupe dont les enfants sont, ligne par ligne, chaque cellule (un rectangle pour
 * le fond et les bordures) suivie de son texte (un cadre de texte). Les largeurs des colonnes et
 * les hauteurs des lignes se lisent dans les rectangles ; une ligne grandit avec son texte.
 */
export interface TableInfo {
  rows: number;
  cols: number;
  /** Première ligne en en-tête (fond distinct, texte en gras). */
  header?: boolean;
  /** Marge intérieure des cellules, en pixels (6 si absent). */
  padding?: number;
}

/** Réglage d'image (couleurs, tons) ou filtre dynamique (flou, netteté…), non destructif. */
export type Adjustment =
  | { kind: 'brightnessContrast'; brightness: number; contrast: number }
  /** Niveaux d'entrée et de sortie de 0 à 255, gamma de 0,1 à 10. */
  | { kind: 'levels'; black: number; white: number; gamma: number; outBlack: number; outWhite: number }
  /** Courbes : points (entrée, sortie) de 0 à 1, pour l'ensemble et pour chaque canal. */
  | {
      kind: 'curves';
      rgb: [number, number][];
      r: [number, number][];
      g: [number, number][];
      b: [number, number][];
    }
  /** Teinte en degrés (−180 à 180), saturation et luminosité de −100 à 100. */
  | { kind: 'hsl'; hue: number; saturation: number; lightness: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  /** Exposition en IL (−5 à 5). */
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'whiteBalance'; temperature: number; tint: number }
  /** Balance des couleurs : [cyan↔rouge, magenta↔vert, jaune↔bleu] de −100 à 100 par plage de tons. */
  | {
      kind: 'colorBalance';
      shadows: [number, number, number];
      midtones: [number, number, number];
      highlights: [number, number, number];
    }
  /** Noir et blanc : part de chaque canal, en pourcentage. */
  | { kind: 'blackWhite'; red: number; green: number; blue: number }
  | { kind: 'photoFilter'; color: Color; density: number }
  | { kind: 'gradientMap'; stops: GradientStop[] }
  | { kind: 'invert' }
  | { kind: 'threshold'; level: number }
  | { kind: 'posterize'; levels: number }
  /**
   * Table de correspondance 3D (fichier `.cube` ou look intégré) : `size`³ couleurs en entiers de
   * 16 bits, rouge d'abord, encodées en base64 (voir `lut.ts`).
   */
  | { kind: 'lut'; name: string; size: number; data: string }
  // Filtres dynamiques (rayons en pixels du document).
  | { kind: 'gaussianBlur'; radius: number }
  | { kind: 'unsharpMask'; amount: number; radius: number; threshold: number }
  | { kind: 'noise'; amount: number; monochrome: boolean }
  | { kind: 'vignette'; amount: number; size: number; softness: number }
  | { kind: 'pixelate'; size: number }
  | { kind: 'clarity'; amount: number };
export type AdjustmentKind = Adjustment['kind'];

/**
 * Calque de réglage : agit sur tout ce qui est dessous dans le même parent (plan de travail ou
 * groupe). Sa boîte sert de repère à son masque.
 */
export interface AdjustmentNode extends NodeBase {
  type: 'adjustment';
  adjustment: Adjustment;
}

export type ShapeNode = RectNode | EllipseNode | PolygonNode | StarNode | LineNode | PathNode;
export type SceneNode = ShapeNode | TextNode | ImageNode | GroupNode | AdjustmentNode | SymbolNode;
/** Objets qui ont un remplissage et un contour. */
export type StyledNode = ShapeNode | TextNode;
export type NodeType = SceneNode['type'];

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: Paint;
  /** Du dessous vers le dessus. */
  children: SceneNode[];
  /** Page maître : ses objets apparaissent sur les pages qui l'utilisent ; elle n'est pas une page. */
  master?: boolean;
  /** Page maître utilisée par cette page. */
  masterId?: string;
  /** Objets de la page maître cachés sur cette page (détachés : la page en a une copie). */
  masterHidden?: string[];
}

/** Marges d'une page, en pixels. Sur les pages en vis-à-vis, `inside` est du côté de la reliure. */
export interface Margins {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

/** Réglages de mise en page et d'impression du document. */
export interface DocumentLayout {
  /** Résolution : pixels par pouce. Donne la taille réelle à l'impression (96 si absent). */
  dpi?: number;
  /** Fond perdu autour de chaque page, en pixels. */
  bleed?: number;
  /** Marges des pages, affichées comme des repères. */
  margins?: Margins;
  /** Pages en vis-à-vis (livre, magazine) : la page 1 seule à droite, puis des doubles pages. */
  facing?: boolean;
  /** Numéro de la première page (1 si absent). */
  firstNumber?: number;
  /** Mode couleur de l'impression : `cmyk` montre les valeurs CMJN et prépare les PDF en CMJN. */
  colorMode?: 'rgb' | 'cmyk';
  /** Couleurs choisies en CMJN : valeurs exactes (en %), par couleur `#rrggbb`. */
  cmyk?: Record<Color, [number, number, number, number]>;
}

/**
 * Symbole : un contenu réutilisable (comme dans Affinity). Ses objets sont exprimés dans la
 * boîte `box` ; chaque instance les ramène dans sa propre boîte.
 */
export interface Symbol {
  id: string;
  name: string;
  box: { x: number; y: number; width: number; height: number };
  children: SceneNode[];
}

/**
 * Style enregistré (style de calque ou de texte) : les réglages d'apparence qu'un clic applique
 * à la sélection.
 */
export interface SavedStyle {
  id: string;
  name: string;
  fill?: Paint;
  stroke?: Stroke;
  strokes?: Stroke[];
  effects?: Effect[];
  opacity?: number;
  blendMode?: BlendMode;
  /** Style de texte : appliqué seulement aux textes. */
  text?: Partial<TextStyle>;
}

export interface Asset {
  id: string;
  mime: string;
  width: number;
  height: number;
  /** Données encodées en `data:` URL. Dans le fichier `.poulpe`, stockées dans `assets/images/`. */
  data: string;
}

export interface PoulpeDocument {
  format: 'poulpe';
  version: number;
  id: string;
  name: string;
  artboards: Artboard[];
  /** Nuancier du document. */
  swatches: Color[];
  /** Repères tirés depuis les règles, en coordonnées du document. */
  guides?: { x: number[]; y: number[] };
  assets: Record<string, Asset>;
  /** Mise en page et impression. */
  layout?: DocumentLayout;
  /** Symboles du document, par id. */
  symbols?: Record<string, Symbol>;
  /** Styles de calque et de texte enregistrés. */
  styles?: SavedStyle[];
}

export type Parent = Artboard | GroupNode;
