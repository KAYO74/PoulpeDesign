import {
  createArtboard,
  createDocument,
  findFormat,
  newId,
  translateNode,
  type Artboard,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  isStyled,
} from '@poulpe/core';
import {
  circle,
  ellipse,
  group,
  line,
  linear,
  paint,
  path,
  radial,
  rect,
  star,
  text,
  tr,
  type Fill,
  type Lang,
  type Tr,
} from './dsl';
import { ICONS, ICON_VIEWBOX } from './icons';
import { ILLUSTRATIONS } from './illustrations';
import { FRAME_FILL, frameContent } from './shapes';
import { SOCIAL_TEMPLATES } from './templatesSocial';

/*
 * Modèles prêts à l'emploi, dessinés pour Poulpe (même licence que l'appli). Un modèle décrit le
 * contenu d'un plan de travail dans le format indiqué, avec ses textes en français et en anglais.
 * Tout y est modifiable : ce sont des objets ordinaires.
 */

export interface TemplateContent {
  background: Paint;
  children: SceneNode[];
}

export interface TemplateDef {
  id: string;
  name: Tr;
  /** Identifiant d'un format de `FORMAT_PRESETS`. */
  format: string;
  /** Mots-clés de recherche (français et anglais). */
  tags: string;
  build: (lang: Lang) => TemplateContent;
}

const WAVE = 'M0 30C17 10 33 10 50 30S83 50 100 30V100H0Z';
const WAVE_VB: [number, number, number, number] = [0, 15, 100, 85];
const SPARKLE = 'M50 0C54 30 70 46 100 50C70 54 54 70 50 100C46 70 30 54 0 50C30 46 46 30 50 0Z';
const ARROW = 'M0 35H60V10L100 50L60 90V65H0Z';
const LEAF = 'M50 0C80 20 92 55 50 100C8 55 20 20 50 0Z';
const BLOB =
  'M55 2C75 4 92 16 98 34C100 52 92 70 80 84C66 98 44 100 26 92C10 84 0 66 2 48C4 28 14 12 30 5C38 2 46 1 55 2Z';

function icon(id: string, x: number, y: number, size: number, color: Fill): SceneNode {
  const def = ICONS.find((i) => i.id === id);
  if (!def) throw new Error(`icône inconnue : ${id}`);
  return path(def.d, [ICON_VIEWBOX, ICON_VIEWBOX], x, y, size, size, color, { name: def.fr.split(' ')[0] });
}

/** Cadre photo : déposer une image dessus la place dedans. */
function photo(mask: SceneNode, name = 'Photo'): SceneNode {
  return group(frameContent(mask), name, { clip: true });
}

/** Colore une partie d'un texte. */
function highlight(node: TextNode, part: string, color: string): TextNode {
  const start = node.text.indexOf(part);
  if (start >= 0) node.runs = [{ start, end: start + part.length, style: { color } }];
  return node;
}

/** Illustration de la bibliothèque, mise à la taille voulue. */
function illustration(id: string, lang: Lang, x: number, y: number, width: number): SceneNode {
  const def = ILLUSTRATIONS.find((i) => i.id === id)!;
  const node = def.build(lang);
  const k = width / def.width;
  scaleTree(node, k);
  translateNode(node, x, y);
  return node;
}

function scaleTree(n: SceneNode, k: number) {
  n.x *= k;
  n.y *= k;
  n.width *= k;
  n.height *= k;
  if (n.type === 'group') n.children.forEach((c) => scaleTree(c, k));
  else if (n.type === 'text') n.style = { ...n.style, fontSize: n.style.fontSize * k };
  else if (isStyled(n)) n.stroke = { ...n.stroke, width: n.stroke.width * k };
}

const L = (lang: Lang) => (fr: string, en: string) => (lang === 'fr' ? fr : en);

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'summerSale',
    name: tr('Soldes d’été', 'Summer sale'),
    format: 'instagram',
    tags: 'soldes promo vente été sale promotion summer',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#ffd25f'),
        children: [
          circle(920, 170, 330, '#ff8a5b', { name: t('Soleil', 'Sun') }),
          text(80, 120, 900, t('SOLDES', 'SUMMER'), '#1a1a1d', {
            font: 'Oswald',
            size: 230,
            weight: 700,
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          text(80, 350, 900, t('D’ÉTÉ', 'SALE'), '#ff5f86', {
            font: 'Oswald',
            size: 230,
            weight: 700,
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          text(
            86,
            630,
            540,
            t('Toute la collection, en boutique et en ligne', 'The whole collection, in store and online'),
            '#1a1a1d',
            {
              size: 44,
              weight: 600,
              block: true,
              lineHeight: 1.25,
            },
          ),
          star(700, 540, 300, 300, '#1a1a1d', { points: 24, inner: 0.86, name: 'Badge' }),
          text(700, 590, 300, t('jusqu’à', 'up to'), '#ffffff', { size: 34, weight: 600, align: 'center' }),
          text(700, 630, 300, '-50%', '#ffd25f', {
            font: 'Oswald',
            size: 110,
            weight: 700,
            align: 'center',
            lineHeight: 1,
          }),
          path(WAVE, WAVE_VB, 0, 880, 1080, 200, '#2ba59a', { name: t('Vague', 'Wave') }),
          text(0, 985, 1080, t('Du 1er au 15 juillet', 'July 1 to 15'), '#ffffff', {
            size: 40,
            weight: 600,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'quote',
    name: tr('Citation', 'Quote'),
    format: 'instagram',
    tags: 'citation phrase inspiration quote motivation',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#f4efe6'),
        children: [
          text(100, 40, 300, '“', '#e07a5f', {
            font: 'Playfair Display',
            size: 420,
            weight: 700,
            lineHeight: 1,
          }),
          text(
            120,
            330,
            840,
            t(
              'Les petites choses faites chaque jour finissent par en faire de grandes.',
              'Small things done every day end up making big ones.',
            ),
            '#1b2a41',
            {
              font: 'Playfair Display',
              size: 66,
              italic: true,
              block: true,
              lineHeight: 1.3,
              name: t('Citation', 'Quote'),
            },
          ),
          rect(120, 770, 120, 6, '#e07a5f', { name: t('Trait', 'Rule') }),
          text(120, 810, 840, t('Votre nom', 'Your name'), '#1b2a41', {
            size: 34,
            weight: 600,
            upper: true,
            spacing: 4,
          }),
          text(120, 975, 840, '@votrecompte', '#1b2a41', { size: 30, align: 'right', opacity: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'festival',
    name: tr('Annonce d’événement', 'Event announcement'),
    format: 'portrait',
    tags: 'événement festival concert annonce soirée event party',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#13315c'),
        children: [
          circle(790, 330, 210, radial('#8ee3d6', '#2ba59a'), { name: t('Soleil', 'Sun') }),
          circle(980, 600, 40, '#2ba59a', { opacity: 0.6 }),
          circle(560, 160, 24, '#8ee3d6', { opacity: 0.6 }),
          text(90, 620, 900, t('Festival\ndes Mers', 'Festival\nof the Sea'), '#f4efe6', {
            font: 'Playfair Display',
            size: 130,
            weight: 700,
            lineHeight: 1.1,
            name: t('Titre', 'Title'),
          }),
          rect(90, 1000, 420, 90, '#2ba59a', { radius: 45, name: t('Date', 'Date') }),
          text(90, 1022, 420, t('12 – 14 juillet', 'July 12 – 14'), '#0b2545', {
            size: 40,
            weight: 700,
            align: 'center',
          }),
          text(
            90,
            1140,
            900,
            t('Port de Saint-Malo · Entrée libre', 'Saint-Malo harbour · Free entry'),
            '#f4efe6',
            {
              size: 36,
              opacity: 0.8,
            },
          ),
          path(SPARKLE, [100, 100], 900, 1130, 90, 90, '#ffd25f', { name: t('Étincelle', 'Sparkle') }),
        ],
      };
    },
  },
  {
    id: 'newProduct',
    name: tr('Nouveau produit', 'New product'),
    format: 'instagram',
    tags: 'produit lancement nouveau boutique prix product launch shop',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(135, '#7b61ff', '#ff5f86'),
        children: [
          photo(rect(540, 140, 450, 600, FRAME_FILL, { radius: 30, name: t('Cadre', 'Frame') })),
          rect(90, 140, 270, 64, '#ffd25f', { radius: 32 }),
          text(90, 155, 270, t('NOUVEAU', 'NEW'), '#1a1a1d', {
            size: 30,
            weight: 700,
            spacing: 3,
            align: 'center',
          }),
          text(90, 250, 430, t('Votre\nproduit\nstar', 'Your\nstar\nproduct'), '#ffffff', {
            font: 'Bricolage Grotesque',
            size: 96,
            weight: 700,
            lineHeight: 1.05,
            name: t('Titre', 'Title'),
          }),
          text(
            90,
            600,
            400,
            t('Dites en une phrase ce qui le rend unique.', 'Say in one sentence what makes it unique.'),
            '#ffffff',
            {
              size: 34,
              block: true,
              lineHeight: 1.3,
              opacity: 0.9,
            },
          ),
          circle(860, 800, 140, '#ffd25f', { name: t('Prix', 'Price') }),
          text(720, 745, 280, '29 €', '#1a1a1d', {
            font: 'Bricolage Grotesque',
            size: 84,
            weight: 700,
            align: 'center',
            lineHeight: 1,
          }),
          text(720, 840, 280, t('seulement', 'only'), '#1a1a1d', { size: 28, weight: 600, align: 'center' }),
          text(90, 960, 600, t('Disponible en boutique', 'Available in store'), '#ffffff', {
            size: 32,
            weight: 600,
          }),
        ],
      };
    },
  },
  {
    id: 'tips',
    name: tr('Liste d’astuces', 'Tips list'),
    format: 'portrait',
    tags: 'astuces conseils liste carrousel tips list carousel',
    build: (lang) => {
      const t = L(lang);
      const items =
        lang === 'fr'
          ? [
              'Se coucher à heure fixe',
              'Éviter les écrans le soir',
              'Garder la chambre fraîche',
              'Limiter le café après 14 h',
              'Lire quelques pages',
            ]
          : [
              'Go to bed at a set time',
              'Avoid screens at night',
              'Keep the bedroom cool',
              'Skip coffee after 2 pm',
              'Read a few pages',
            ];
      const rows: SceneNode[] = [];
      items.forEach((label, i) => {
        const y = 470 + i * 165;
        rows.push(circle(150, y + 40, 46, '#ffd25f', { name: `${i + 1}` }));
        rows.push(
          text(104, y + 10, 92, String(i + 1), '#1a1a1d', {
            font: 'Montserrat',
            size: 50,
            weight: 800,
            align: 'center',
          }),
        );
        rows.push(text(230, y + 15, 760, label, '#1a1a1d', { size: 42, weight: 600 }));
      });
      return {
        background: paint('#fffaf0'),
        children: [
          rect(0, 0, 1080, 390, '#2ba59a', { name: t('Bandeau', 'Header') }),
          text(90, 90, 900, t('5 astuces pour\nmieux dormir', '5 tips for\nbetter sleep'), '#ffffff', {
            font: 'Montserrat',
            size: 84,
            weight: 800,
            lineHeight: 1.1,
            name: t('Titre', 'Title'),
          }),
          ...rows,
          text(90, 1265, 900, '@votrecompte', '#1a1a1d', { size: 30, opacity: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'storyPromo',
    name: tr('Story promo', 'Promo story'),
    format: 'story',
    tags: 'story promo offre code réduction flash sale discount',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(160, '#0d0221', '#7b2cbf'),
        children: [
          circle(880, 300, 380, radial('#ff3cacaa', '#ff3cac00'), { name: t('Halo', 'Glow') }),
          circle(150, 1500, 300, radial('#2bd2ff66', '#2bd2ff00'), { name: t('Halo', 'Glow') }),
          path(SPARKLE, [100, 100], 830, 420, 140, 140, '#f5f3ff', { name: t('Étincelle', 'Sparkle') }),
          text(90, 540, 900, t('Offre\nflash', 'Flash\nsale'), '#ffffff', {
            font: 'Bricolage Grotesque',
            size: 170,
            weight: 700,
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          text(90, 930, 900, '-30%', '#2bd2ff', { font: 'Oswald', size: 300, weight: 700, lineHeight: 1 }),
          text(
            90,
            1330,
            860,
            t('Ce week-end seulement, avec le code POULPE30', 'This weekend only, with code POULPE30'),
            '#ffffff',
            {
              size: 50,
              weight: 600,
              block: true,
              lineHeight: 1.3,
            },
          ),
          rect(90, 1640, 900, 130, '#ff3cac', { radius: 65, name: t('Bouton', 'Button') }),
          text(90, 1673, 900, t('J’en profite', 'Shop now'), '#ffffff', {
            size: 52,
            weight: 700,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'birthday',
    name: tr('Anniversaire', 'Birthday'),
    format: 'story',
    tags: 'anniversaire fête invitation birthday party',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#fff0f5'),
        children: [
          illustration('confetti', lang, 40, 60, 1000),
          circle(540, 560, 230, '#ffffff', { name: t('Disque', 'Disc') }),
          icon('cake', 390, 410, 300, '#d6336c'),
          text(0, 860, 1080, t('Joyeux\nanniversaire', 'Happy\nbirthday'), '#d6336c', {
            font: 'Pacifico',
            size: 130,
            align: 'center',
            lineHeight: 1.25,
            name: t('Titre', 'Title'),
          }),
          text(0, 1250, 1080, 'Camille', '#2b0f1e', {
            font: 'Montserrat',
            size: 110,
            weight: 800,
            align: 'center',
          }),
          text(
            140,
            1420,
            800,
            t('On fête ses 30 ans samedi à 19 h', 'Join us Saturday at 7 pm for the big 30'),
            '#2b0f1e',
            {
              size: 46,
              align: 'center',
              block: true,
              lineHeight: 1.3,
            },
          ),
          illustration('hearts', lang, 640, 1640, 300),
        ],
      };
    },
  },
  {
    id: 'tutorialThumb',
    name: tr('Miniature tutoriel', 'Tutorial thumbnail'),
    format: 'youtube',
    tags: 'youtube miniature vidéo tutoriel tuto thumbnail video tutorial',
    build: (lang) => {
      const t = L(lang);
      const title = text(70, 190, 640, t('Débuter en\n10 minutes', 'Get started\nin 10 minutes'), '#ffffff', {
        font: 'Montserrat',
        size: 104,
        weight: 800,
        lineHeight: 1.08,
        name: t('Titre', 'Title'),
      });
      return {
        background: paint('#1a1a1d'),
        children: [
          circle(990, 360, 270, '#ffd25f', { name: t('Disque', 'Disc') }),
          photo(ellipse(740, 110, 500, 500, FRAME_FILL)),
          rect(70, 80, 200, 72, '#ff5f86', { radius: 12 }),
          text(70, 88, 200, t('TUTO', 'HOW TO'), '#ffffff', {
            font: 'Oswald',
            size: 46,
            weight: 700,
            align: 'center',
          }),
          highlight(title, t('10 minutes', '10 minutes'), '#ffd25f'),
          path(ARROW, [0, 10, 100, 80], 560, 500, 170, 136, '#ffd25f', {
            rotation: -18,
            name: t('Flèche', 'Arrow'),
          }),
        ],
      };
    },
  },
  {
    id: 'vlogThumb',
    name: tr('Miniature vlog', 'Vlog thumbnail'),
    format: 'youtube',
    tags: 'youtube miniature vidéo vlog voyage thumbnail travel',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(90, '#4cc9f0', '#3a0ca3'),
        children: [
          rect(700, 80, 520, 560, '#ffffff', { radius: 28, rotation: 4, name: t('Bord', 'Border') }),
          photo(rect(720, 100, 480, 520, FRAME_FILL, { radius: 18, rotation: 4 })),
          text(70, 130, 600, t('MA SEMAINE\nAU JAPON', 'MY WEEK\nIN JAPAN'), '#ffffff', {
            font: 'Oswald',
            size: 112,
            weight: 700,
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          star(80, 440, 210, 210, '#ffd25f', { points: 14, inner: 0.72, rotation: -10, name: 'Badge' }),
          text(80, 513, 210, 'VLOG', '#1a1a1d', {
            font: 'Oswald',
            size: 54,
            weight: 700,
            align: 'center',
            rotation: -10,
          }),
        ],
      };
    },
  },
  {
    id: 'webinar',
    name: tr('Webinaire', 'Webinar'),
    format: 'linkedinPost',
    tags: 'webinaire conférence linkedin inscription webinar talk event',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#f8f7ff'),
        children: [
          rect(0, 0, 24, 627, '#6c5ce7', { name: t('Bande', 'Band') }),
          path(BLOB, [100, 100], 770, 60, 470, 470, '#dcd6ff', { name: t('Tache', 'Blob') }),
          photo(ellipse(820, 100, 370, 370, FRAME_FILL)),
          text(
            780,
            495,
            450,
            t('Alex Martin\nFondatrice, Studio Nord', 'Alex Martin\nFounder, Studio Nord'),
            '#2f2a4a',
            {
              size: 26,
              weight: 600,
              align: 'center',
              lineHeight: 1.3,
            },
          ),
          text(90, 80, 640, t('WEBINAIRE GRATUIT', 'FREE WEBINAR'), '#6c5ce7', {
            size: 26,
            weight: 700,
            spacing: 4,
          }),
          text(90, 135, 640, t('Lancer sa boutique en ligne', 'Launch your online shop'), '#2f2a4a', {
            font: 'Montserrat',
            size: 64,
            weight: 800,
            block: true,
            lineHeight: 1.1,
            name: t('Titre', 'Title'),
          }),
          icon('calendar', 90, 375, 40, '#6c5ce7'),
          text(
            145,
            377,
            560,
            t('Jeudi 20 novembre · 18 h 30', 'Thursday, November 20 · 6:30 pm'),
            '#2f2a4a',
            { size: 30, weight: 600 },
          ),
          rect(90, 470, 330, 76, '#6c5ce7', { radius: 38, name: t('Bouton', 'Button') }),
          text(90, 489, 330, t('Je m’inscris', 'Register'), '#ffffff', {
            size: 30,
            weight: 700,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'grandOpening',
    name: tr('Grande ouverture', 'Grand opening'),
    format: 'facebookPost',
    tags: 'ouverture boutique magasin facebook commerce opening shop store',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#264653'),
        children: [
          circle(950, 300, 250, '#2a9d8f', { name: t('Disque', 'Disc') }),
          icon('storefront', 810, 160, 280, '#e9c46a'),
          circle(1130, 70, 30, '#f4a261'),
          circle(720, 540, 20, '#e76f51'),
          text(80, 110, 640, t('Grande\nouverture', 'Grand\nopening'), '#e9c46a', {
            font: 'Bricolage Grotesque',
            size: 110,
            weight: 700,
            lineHeight: 1.02,
            name: t('Titre', 'Title'),
          }),
          text(
            80,
            390,
            640,
            t('Samedi dès 9 h · 12 rue des Lilas', 'Saturday from 9 am · 12 Lilac Street'),
            '#ffffff',
            {
              size: 34,
              weight: 600,
            },
          ),
          text(
            80,
            450,
            640,
            t('Un café offert aux 50 premiers clients', 'Free coffee for the first 50 customers'),
            '#ffffff',
            {
              size: 30,
              opacity: 0.75,
            },
          ),
        ],
      };
    },
  },
  {
    id: 'concertPoster',
    name: tr('Affiche de concert', 'Concert poster'),
    format: 'a4',
    tags: 'affiche concert soirée musique électro poster music party',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#0d0221'),
        children: [
          circle(1240, 1300, 860, radial('#7b2cbf', '#0d0221'), { name: t('Halo', 'Glow') }),
          ellipse(440, 500, 1600, 1600, undefined, { stroke: ['#ff3cac', 36], name: t('Anneau', 'Ring') }),
          text(0, 820, 2480, t('NUIT\nÉLECTRO', 'ELECTRO\nNIGHT'), '#f5f3ff', {
            font: 'Oswald',
            size: 520,
            weight: 700,
            align: 'center',
            lineHeight: 0.95,
            name: t('Titre', 'Title'),
          }),
          text(0, 2320, 2480, 'DJ Poulpe · Lumen · Kaïa', '#2bd2ff', {
            font: 'Montserrat',
            size: 110,
            weight: 700,
            align: 'center',
          }),
          text(0, 2580, 2480, t('SAMEDI 14 MARS · 22 H', 'SATURDAY, MARCH 14 · 10 PM'), '#ffffff', {
            font: 'Oswald',
            size: 140,
            align: 'center',
            spacing: 8,
          }),
          text(0, 2820, 2480, t('La Friche, Marseille', 'The Warehouse, Bristol'), '#ffffff', {
            size: 90,
            align: 'center',
            opacity: 0.8,
          }),
          rect(0, 3200, 2480, 308, '#ff3cac', { name: t('Bandeau', 'Banner') }),
          text(0, 3300, 2480, t('Billets sur votresite.fr', 'Tickets at yoursite.com'), '#0d0221', {
            size: 90,
            weight: 700,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'menu',
    name: tr('Menu de restaurant', 'Restaurant menu'),
    format: 'a4',
    tags: 'menu restaurant carte cuisine bistrot food',
    build: (lang) => {
      const t = L(lang);
      const sections: [string, [string, string, string][]][] =
        lang === 'fr'
          ? [
              [
                'ENTRÉES',
                [
                  ['Velouté de potimarron', 'Crème fraîche, graines torréfiées', '8 €'],
                  ['Œuf parfait', 'Champignons des bois, mouillettes', '9 €'],
                ],
              ],
              [
                'PLATS',
                [
                  ['Filet de dorade', 'Fenouil confit, beurre citronné', '19 €'],
                  ['Risotto aux cèpes', 'Parmesan affiné, roquette', '17 €'],
                ],
              ],
              [
                'DESSERTS',
                [
                  ['Tarte fine aux pommes', 'Glace vanille de Madagascar', '8 €'],
                  ['Mousse au chocolat', 'Fleur de sel, tuile croustillante', '7 €'],
                ],
              ],
            ]
          : [
              [
                'STARTERS',
                [
                  ['Pumpkin velouté', 'Crème fraîche, toasted seeds', '8 €'],
                  ['Slow-cooked egg', 'Wild mushrooms, soldiers', '9 €'],
                ],
              ],
              [
                'MAINS',
                [
                  ['Sea bream fillet', 'Candied fennel, lemon butter', '19 €'],
                  ['Porcini risotto', 'Aged parmesan, rocket', '17 €'],
                ],
              ],
              [
                'DESSERTS',
                [
                  ['Thin apple tart', 'Madagascar vanilla ice cream', '8 €'],
                  ['Chocolate mousse', 'Sea salt, crisp tuile', '7 €'],
                ],
              ],
            ];
      const nodes: SceneNode[] = [];
      let y = 1240;
      for (const [head, items] of sections) {
        nodes.push(
          text(0, y, 2480, head, '#b08968', {
            font: 'Montserrat',
            size: 64,
            weight: 700,
            align: 'center',
            spacing: 12,
          }),
        );
        y += 140;
        for (const [name, desc, price] of items) {
          nodes.push(
            text(300, y, 1500, name, '#2b1d16', { font: 'Playfair Display', size: 80, weight: 700 }),
          );
          nodes.push(
            text(1680, y + 8, 500, price, '#2b1d16', {
              font: 'Montserrat',
              size: 70,
              weight: 700,
              align: 'right',
            }),
          );
          nodes.push(text(300, y + 105, 1600, desc, '#6f4e37', { font: 'Lora', size: 56, italic: true }));
          y += 250;
        }
        y += 40;
      }
      return {
        background: paint('#faf6f1'),
        children: [
          icon('fork-knife', 1140, 110, 200, '#b08968'),
          text(0, 360, 2480, t('Le Petit\nBistrot', 'The Little\nBistro'), '#2b1d16', {
            font: 'Playfair Display',
            size: 250,
            weight: 700,
            align: 'center',
            lineHeight: 1.05,
            name: t('Titre', 'Title'),
          }),
          text(0, 960, 2480, t('MENU DU JOUR', 'TODAY’S MENU'), '#b08968', {
            font: 'Montserrat',
            size: 70,
            weight: 700,
            align: 'center',
            spacing: 20,
          }),
          line(940, 1120, 1540, 1120, '#b08968', 4, { name: t('Trait', 'Rule') }),
          ...nodes,
          text(
            0,
            3290,
            2480,
            t('Fait maison avec des produits de saison', 'Homemade with seasonal produce'),
            '#6f4e37',
            {
              font: 'Lora',
              size: 56,
              italic: true,
              align: 'center',
            },
          ),
        ],
      };
    },
  },
  {
    id: 'businessCard',
    name: tr('Carte de visite', 'Business card'),
    format: 'businessCard',
    tags: 'carte de visite contact professionnel business card',
    build: (lang) => {
      const t = L(lang);
      const contacts: [string, string][] = [
        ['phone', '06 12 34 56 78'],
        ['envelope', 'camille@studio-nord.fr'],
        ['globe', 'studio-nord.fr'],
      ];
      return {
        background: paint('#14213d'),
        children: [
          text(70, 120, 600, 'Camille Durand', '#fbf8f1', {
            font: 'Playfair Display',
            size: 64,
            weight: 700,
            name: t('Nom', 'Name'),
          }),
          text(70, 215, 600, t('Architecte d’intérieur', 'Interior architect'), '#c9a227', {
            font: 'Montserrat',
            size: 24,
            upper: true,
            spacing: 4,
          }),
          rect(70, 280, 80, 4, '#c9a227', { name: t('Trait', 'Rule') }),
          ...contacts.flatMap(([ic, label], i) => [
            icon(ic, 70, 335 + i * 58, 30, '#c9a227'),
            text(120, 336 + i * 58, 480, label, '#fbf8f1', { size: 24 }),
          ]),
          circle(840, 300, 130, undefined, { stroke: ['#c9a227', 4], name: t('Monogramme', 'Monogram') }),
          text(710, 240, 260, 'CD', '#c9a227', {
            font: 'Playfair Display',
            size: 100,
            weight: 700,
            align: 'center',
            lineHeight: 1,
          }),
        ],
      };
    },
  },
  {
    id: 'wedding',
    name: tr('Faire-part de mariage', 'Wedding invitation'),
    format: 'invitation',
    tags: 'mariage invitation faire-part wedding',
    build: (lang) => {
      const t = L(lang);
      const leaves = (x: number, y: number, flip: number) =>
        [0, 1, 2].map((i) =>
          path(
            LEAF,
            [100, 100],
            x + flip * i * 70,
            y + i * 40,
            90,
            150,
            ['#7ba77e', '#a7c4a0', '#2f5d46'][i],
            {
              rotation: flip * (30 + i * 25),
              name: t('Feuille', 'Leaf'),
            },
          ),
        );
      return {
        background: paint('#fbf8f1'),
        children: [
          rect(80, 80, 1340, 1940, undefined, { stroke: ['#c9a227', 4], name: t('Cadre', 'Border') }),
          ...leaves(160, 140, 1),
          ...leaves(1250, 140, -1),
          text(0, 420, 1500, t('Nous nous marions', 'We are getting married'), '#2f5d46', {
            font: 'Montserrat',
            size: 44,
            upper: true,
            spacing: 12,
            align: 'center',
          }),
          text(0, 560, 1500, 'Alice\n&\nThomas', '#2f5d46', {
            font: 'Playfair Display',
            size: 200,
            italic: true,
            align: 'center',
            lineHeight: 1.15,
            name: t('Noms', 'Names'),
          }),
          text(0, 1370, 1500, t('Samedi 12 septembre', 'Saturday, September 12'), '#2b1d16', {
            font: 'Lora',
            size: 70,
            align: 'center',
          }),
          text(0, 1480, 1500, t('à 15 h · Domaine des Oliviers', '3 pm · Olive Grove Estate'), '#2b1d16', {
            font: 'Lora',
            size: 56,
            align: 'center',
          }),
          text(
            0,
            1800,
            1500,
            t('Réponse souhaitée avant le 1er juillet', 'Kindly reply by July 1'),
            '#7ba77e',
            {
              font: 'Montserrat',
              size: 36,
              upper: true,
              spacing: 4,
              align: 'center',
            },
          ),
        ],
      };
    },
  },
  {
    id: 'titleSlide',
    name: tr('Diapositive de titre', 'Title slide'),
    format: 'presentation',
    tags: 'présentation diapositive titre rapport slide presentation report',
    build: (lang) => {
      const t = L(lang);
      const dots: SceneNode[] = [];
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
          dots.push(circle(1380 + i * 50, 120 + j * 50, 8, '#8ee3d6', { name: '·' }));
      return {
        background: paint('#0b2545'),
        children: [
          rect(1300, 0, 620, 1080, '#13315c', { name: t('Bande', 'Band') }),
          ...dots,
          circle(1610, 400, 230, '#2ba59a', { name: t('Disque', 'Disc') }),
          path('M0 0A100 100 0 0 1 100 100H0Z', [100, 100], 1400, 640, 440, 440, '#8ee3d6', {
            name: t('Quart de cercle', 'Quarter circle'),
          }),
          text(140, 280, 1100, t('Rapport\nannuel', 'Annual\nreport'), '#ffffff', {
            font: 'Montserrat',
            size: 170,
            weight: 800,
            lineHeight: 1.02,
            name: t('Titre', 'Title'),
          }),
          text(140, 690, 1100, t('Résultats et perspectives', 'Results and outlook'), '#8ee3d6', {
            size: 56,
          }),
          text(140, 900, 1100, t('Équipe marketing · Mars', 'Marketing team · March'), '#ffffff', {
            size: 32,
            weight: 600,
            opacity: 0.7,
          }),
        ],
      };
    },
  },
  {
    id: 'recipePin',
    name: tr('Épingle recette', 'Recipe pin'),
    format: 'pinterest',
    tags: 'pinterest recette cuisine épingle recipe food pin',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#fffbf0'),
        children: [
          photo(rect(0, 0, 1000, 820, FRAME_FILL)),
          rect(230, 760, 540, 110, '#fe7f2d', { radius: 55, name: t('Étiquette', 'Label') }),
          text(230, 793, 540, t('RECETTE FACILE', 'EASY RECIPE'), '#ffffff', {
            font: 'Montserrat',
            size: 38,
            weight: 800,
            align: 'center',
            spacing: 4,
          }),
          text(0, 930, 1000, t('Tarte aux\nabricots', 'Apricot\ntart'), '#233d4d', {
            font: 'Playfair Display',
            size: 120,
            weight: 700,
            align: 'center',
            lineHeight: 1.05,
            name: t('Titre', 'Title'),
          }),
          icon('clock', 290, 1250, 48, '#fe7f2d'),
          text(350, 1254, 200, '45 min', '#233d4d', { size: 36, weight: 600 }),
          icon('users', 540, 1250, 48, '#fe7f2d'),
          text(600, 1254, 200, t('6 pers.', 'Serves 6'), '#233d4d', { size: 36, weight: 600 }),
          text(0, 1395, 1000, t('votresite.fr', 'yoursite.com'), '#233d4d', {
            size: 30,
            align: 'center',
            opacity: 0.7,
          }),
        ],
      };
    },
  },
  {
    id: 'postcard',
    name: tr('Carte postale', 'Postcard'),
    format: 'postcard',
    tags: 'carte postale vacances voyage mer postcard holiday travel sea',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(90, '#ffd25f', '#ff8a5b'),
        children: [
          circle(1580, 230, 130, '#fff4e0', { opacity: 0.9, name: t('Soleil', 'Sun') }),
          text(0, 170, 1800, t('Bons baisers\nde Bretagne', 'Greetings\nfrom Cornwall'), '#ffffff', {
            font: 'Pacifico',
            size: 150,
            align: 'center',
            lineHeight: 1.3,
            name: t('Titre', 'Title'),
          }),
          illustration('waves', lang, -60, 780, 1920),
        ],
      };
    },
  },
  {
    id: 'logo',
    name: tr('Logo', 'Logo'),
    format: 'logo',
    tags: 'logo marque identité fleuriste brand identity',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#ffffff'),
        children: [
          circle(500, 380, 190, '#2ba59a', { name: t('Disque', 'Disc') }),
          icon('plant', 380, 260, 240, '#ffffff'),
          text(0, 610, 1000, 'Atelier Vert', '#1b2d24', {
            font: 'Bricolage Grotesque',
            size: 110,
            weight: 700,
            align: 'center',
            name: t('Nom', 'Name'),
          }),
          text(0, 770, 1000, t('FLEURISTE · LYON', 'FLORIST · LONDON'), '#7ba77e', {
            font: 'Montserrat',
            size: 38,
            align: 'center',
            spacing: 12,
          }),
        ],
      };
    },
  },
  ...SOCIAL_TEMPLATES,
];

/** Place le contenu d'un modèle dans un plan de travail (remplace son contenu). */
export function fillArtboard(ab: Artboard, def: TemplateDef, lang: Lang): string[] {
  const content = def.build(lang);
  ab.background = content.background;
  ab.children = content.children;
  for (const n of ab.children) translateNode(n, ab.x, ab.y);
  return ab.children.map((n) => n.id);
}

/** Document d'un seul plan de travail, rempli avec le modèle (nouveau document, aperçu). */
export function templateDocument(def: TemplateDef, lang: Lang): PoulpeDocument {
  const f = findFormat(def.format)!;
  const doc = createDocument({ name: def.name[lang], width: f.width, height: f.height });
  fillArtboard(doc.artboards[0], def, lang);
  doc.artboards[0].name = def.name[lang];
  return doc;
}

/** Nouveau plan de travail rempli avec le modèle, à la position donnée. */
export function templateArtboard(def: TemplateDef, lang: Lang, x: number, y: number): Artboard {
  const f = findFormat(def.format)!;
  const ab = createArtboard({ x, y, width: f.width, height: f.height, name: def.name[lang] });
  ab.id = newId('ab');
  fillArtboard(ab, def, lang);
  return ab;
}
