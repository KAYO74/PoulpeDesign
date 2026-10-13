import type { SceneNode } from '@poulpe/core';
import { circle, group, linear, paint, path, rect, star, text, tr, type Fill, type Lang } from './dsl';
import { ICONS, ICON_VIEWBOX } from './icons';
import { FRAME_FILL, frameContent } from './shapes';
import type { TemplateDef } from './templates';

/*
 * Modèles pour les réseaux sociaux ajoutés en 1.2.3 (TikTok, stories, carrousels, bannières de
 * profil). Même principe que templates.ts : des objets ordinaires, textes en français et en anglais.
 */

const L = (lang: Lang) => (fr: string, en: string) => (lang === 'fr' ? fr : en);

function icon(id: string, x: number, y: number, size: number, color: Fill): SceneNode {
  const def = ICONS.find((i) => i.id === id);
  if (!def) throw new Error(`icône inconnue : ${id}`);
  return path(def.d, [ICON_VIEWBOX, ICON_VIEWBOX], x, y, size, size, color, { name: def.fr.split(' ')[0] });
}

const photo = (mask: SceneNode, name = 'Photo'): SceneNode => group(frameContent(mask), name, { clip: true });

export const SOCIAL_TEMPLATES: TemplateDef[] = [
  {
    id: 'tiktokCover',
    name: tr('Couverture TikTok', 'TikTok cover'),
    format: 'tiktok',
    tags: 'tiktok reels shorts vidéo couverture video cover',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(160, '#111827', '#3b0764'),
        children: [
          photo(rect(90, 260, 900, 900, FRAME_FILL, { radius: 60, name: t('Cadre', 'Frame') })),
          rect(90, 1230, 520, 90, '#ff5f86', { radius: 45, name: t('Étiquette', 'Label') }),
          text(90, 1252, 520, t('ÉPISODE 1', 'EPISODE 1'), '#ffffff', {
            size: 40,
            weight: 700,
            align: 'center',
            spacing: 4,
          }),
          text(90, 1360, 900, t('Ma journée\nen 60 secondes', 'My day\nin 60 seconds'), '#ffffff', {
            font: 'Bricolage Grotesque',
            size: 110,
            weight: 800,
            lineHeight: 1.05,
            name: t('Titre', 'Title'),
          }),
          icon('play-circle', 830, 1640, 160, '#8ee3d6'),
          text(90, 1700, 700, '@votrecompte', '#ffffff', { size: 40, opacity: 0.7 }),
        ],
      };
    },
  },
  {
    id: 'storyPoll',
    name: tr('Sondage en story', 'Story poll'),
    format: 'story',
    tags: 'story sondage question vote avis poll question',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(180, '#ffd25f', '#ff8a5b'),
        children: [
          circle(880, 260, 260, '#ffffff', { opacity: 0.25 }),
          circle(140, 1560, 200, '#ffffff', { opacity: 0.2 }),
          icon('question', 440, 320, 200, '#1a1a1d'),
          text(90, 600, 900, t('Café ou thé\nle matin ?', 'Coffee or tea\nin the morning?'), '#1a1a1d', {
            font: 'Montserrat',
            size: 96,
            weight: 800,
            align: 'center',
            lineHeight: 1.1,
            name: t('Question', 'Question'),
          }),
          rect(140, 960, 800, 150, '#ffffff', { radius: 75, name: t('Choix 1', 'Choice 1') }),
          text(140, 1005, 800, t('Café', 'Coffee'), '#1a1a1d', { size: 56, weight: 700, align: 'center' }),
          rect(140, 1150, 800, 150, '#1a1a1d', { radius: 75, name: t('Choix 2', 'Choice 2') }),
          text(140, 1195, 800, t('Thé', 'Tea'), '#ffffff', { size: 56, weight: 700, align: 'center' }),
          text(90, 1420, 900, t('Répondez en story !', 'Answer in your story!'), '#1a1a1d', {
            size: 44,
            weight: 600,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'carouselCover',
    name: tr('Carrousel : couverture', 'Carousel cover'),
    format: 'portrait',
    tags: 'carrousel astuces conseils liste instagram linkedin carousel tips list',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#f4efe6'),
        children: [
          rect(0, 0, 1080, 24, '#2ba59a', { name: t('Bande', 'Band') }),
          text(90, 160, 400, '5', '#2ba59a', {
            font: 'Bricolage Grotesque',
            size: 360,
            weight: 800,
            lineHeight: 1,
            name: t('Nombre', 'Number'),
          }),
          text(
            90,
            560,
            900,
            t('astuces pour mieux organiser sa semaine', 'tips to plan your week better'),
            '#1b2a41',
            {
              font: 'Bricolage Grotesque',
              size: 92,
              weight: 700,
              block: true,
              lineHeight: 1.1,
              name: t('Titre', 'Title'),
            },
          ),
          text(90, 1060, 700, t('Votre nom · votre métier', 'Your name · your job'), '#1b2a41', {
            size: 36,
            opacity: 0.7,
          }),
          circle(900, 1150, 90, '#1b2a41', { name: t('Suivant', 'Next') }),
          icon('arrow-right', 855, 1105, 90, '#f4efe6'),
          text(560, 1180, 260, t('Faites glisser', 'Swipe'), '#1b2a41', {
            size: 32,
            weight: 600,
            align: 'right',
          }),
        ],
      };
    },
  },
  {
    id: 'giveaway',
    name: tr('Concours', 'Giveaway'),
    format: 'instagram',
    tags: 'concours jeu cadeau gagner giveaway contest win gift',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(135, '#7b61ff', '#2ba59a'),
        children: [
          star(60, 60, 140, 140, '#ffd25f', { points: 5, inner: 0.45, opacity: 0.8 }),
          star(880, 120, 110, 110, '#ffffff', { points: 5, inner: 0.45, opacity: 0.6 }),
          icon('gift', 390, 110, 300, '#ffffff'),
          text(0, 440, 1080, t('CONCOURS', 'GIVEAWAY'), '#ffffff', {
            font: 'Oswald',
            size: 170,
            weight: 700,
            align: 'center',
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          rect(140, 660, 800, 260, '#ffffff', { radius: 40, name: t('Règles', 'Rules') }),
          text(
            190,
            695,
            700,
            t(
              '1. Abonnez-vous\n2. Aimez cette publication\n3. Identifiez deux amis',
              '1. Follow us\n2. Like this post\n3. Tag two friends',
            ),
            '#1a1a1d',
            { size: 44, weight: 600, lineHeight: 1.35, name: t('Règles', 'Rules') },
          ),
          text(0, 970, 1080, t('Tirage le 30 juin', 'Winner drawn June 30'), '#ffffff', {
            size: 40,
            weight: 600,
            align: 'center',
          }),
        ],
      };
    },
  },
  {
    id: 'recipeStory',
    name: tr('Recette en story', 'Recipe story'),
    format: 'story',
    tags: 'recette cuisine story food recipe cooking',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#fff7ed'),
        children: [
          photo(rect(0, 0, 1080, 1100, FRAME_FILL, { name: t('Cadre', 'Frame') })),
          rect(60, 980, 960, 820, '#ffffff', { radius: 50, name: t('Carte', 'Card') }),
          icon('chef-hat', 120, 1040, 110, '#e76f51'),
          text(260, 1060, 700, t('Recette du jour', 'Recipe of the day'), '#e76f51', {
            size: 40,
            weight: 700,
            upper: true,
            spacing: 3,
          }),
          text(120, 1190, 840, t('Tarte fine aux tomates', 'Thin tomato tart'), '#1a1a1d', {
            font: 'Playfair Display',
            size: 84,
            weight: 700,
            block: true,
            lineHeight: 1.1,
            name: t('Titre', 'Title'),
          }),
          icon('clock', 120, 1450, 60, '#1a1a1d'),
          text(200, 1458, 300, '35 min', '#1a1a1d', { size: 40, weight: 600 }),
          icon('users', 520, 1450, 60, '#1a1a1d'),
          text(600, 1458, 360, t('4 personnes', 'Serves 4'), '#1a1a1d', { size: 40, weight: 600 }),
          text(120, 1600, 840, t('La recette complète en lien ↑', 'Full recipe at the link ↑'), '#1a1a1d', {
            size: 36,
            opacity: 0.6,
          }),
        ],
      };
    },
  },
  {
    id: 'blogLandscape',
    name: tr('Nouvel article', 'New article'),
    format: 'instagramLandscape',
    tags: 'article blog nouveau lien paysage new post link landscape',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#13315c'),
        children: [
          photo(rect(620, 0, 460, 566, FRAME_FILL, { name: t('Cadre', 'Frame') })),
          rect(70, 70, 260, 60, '#ffd25f', { radius: 30, name: t('Étiquette', 'Label') }),
          text(70, 82, 260, t('NOUVEL ARTICLE', 'NEW ARTICLE'), '#13315c', {
            size: 26,
            weight: 700,
            align: 'center',
            spacing: 2,
          }),
          text(70, 170, 500, t('Bien choisir ses couleurs', 'Choosing the right colors'), '#ffffff', {
            font: 'Montserrat',
            size: 62,
            weight: 800,
            block: true,
            lineHeight: 1.1,
            name: t('Titre', 'Title'),
          }),
          text(70, 450, 500, 'votresite.fr', '#8ee3d6', { size: 30, weight: 600 }),
        ],
      };
    },
  },
  {
    id: 'xHeaderBanner',
    name: tr('Bannière de profil X', 'X header banner'),
    format: 'xHeader',
    tags: 'bannière en-tête profil x twitter header banner profile',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(90, '#1b2a41', '#2ba59a'),
        children: [
          circle(1260, -120, 300, '#ffffff', { opacity: 0.08 }),
          circle(1380, 330, 160, '#ffd25f', { opacity: 0.9 }),
          text(560, 170, 800, t('Designer graphique', 'Graphic designer'), '#ffffff', {
            font: 'Montserrat',
            size: 72,
            weight: 800,
            name: t('Titre', 'Title'),
          }),
          text(
            560,
            270,
            800,
            t('Logos · affiches · réseaux sociaux', 'Logos · posters · social media'),
            '#ffffff',
            {
              size: 36,
              opacity: 0.8,
            },
          ),
        ],
      };
    },
  },
  {
    id: 'linkedinBannerPro',
    name: tr('Bannière LinkedIn', 'LinkedIn banner'),
    format: 'linkedinBanner',
    tags: 'bannière linkedin profil professionnel banner profile professional',
    build: (lang) => {
      const t = L(lang);
      return {
        background: paint('#f4efe6'),
        children: [
          rect(0, 0, 1584, 396, linear(90, '#f4efe6', '#d8f3ef'), { name: t('Fond', 'Background') }),
          rect(1180, 0, 404, 396, '#2ba59a', { name: t('Bloc', 'Block') }),
          icon('lightbulb', 1300, 120, 160, '#ffffff'),
          text(560, 120, 600, t('J’aide les petites entreprises', 'I help small businesses'), '#1b2a41', {
            font: 'Montserrat',
            size: 46,
            weight: 800,
            block: true,
            lineHeight: 1.15,
            name: t('Titre', 'Title'),
          }),
          text(560, 250, 600, t('à se faire connaître en ligne', 'get noticed online'), '#2ba59a', {
            size: 34,
            weight: 600,
          }),
        ],
      };
    },
  },
  {
    id: 'youtubeChannel',
    name: tr('Bannière de chaîne vidéo', 'Video channel banner'),
    format: 'youtubeBanner',
    tags: 'bannière chaîne youtube vidéo channel banner video',
    build: (lang) => {
      const t = L(lang);
      return {
        background: linear(120, '#3b0764', '#ff5f86'),
        children: [
          circle(380, 300, 220, '#ffd25f', { opacity: 0.5 }),
          circle(2000, 1000, 300, '#ffffff', { opacity: 0.1 }),
          // Zone visible sur tous les écrans : 1546 × 423 au centre.
          text(507, 560, 1546, t('LA CUISINE DE LÉA', 'LEA’S KITCHEN'), '#ffffff', {
            font: 'Oswald',
            size: 150,
            weight: 700,
            align: 'center',
            lineHeight: 1,
            name: t('Titre', 'Title'),
          }),
          text(507, 740, 1546, t('Nouvelle vidéo chaque mercredi', 'New video every Wednesday'), '#ffffff', {
            size: 52,
            weight: 600,
            align: 'center',
            opacity: 0.9,
          }),
        ],
      };
    },
  },
];
