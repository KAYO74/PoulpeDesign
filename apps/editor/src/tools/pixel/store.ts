import type { Box, PixelGradientKind } from '@poulpe/core';
import { Store } from '../../store';

/* Réglages des outils de pixels de la version 1.2 (recadrage, dégradé, gommes, retouches). */

export type CropRatio = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9' | 'custom';
export type CropOverlay = 'none' | 'thirds' | 'grid' | 'golden';

export interface PixelToolState {
  /** Recadrage : proportions imposées, proportions personnalisées, cadre en hauteur. */
  cropRatio: CropRatio;
  cropW: number;
  cropH: number;
  cropPortrait: boolean;
  /** Repères dessinés dans le cadre. */
  cropOverlay: CropOverlay;
  /** Mode Redresser : glisser trace la ligne à mettre d'aplomb. */
  cropStraighten: boolean;
  /** Rotation de l'image en cours de recadrage, en degrés. */
  cropAngle: number;
  /** Cadre de recadrage (document), null hors de l'outil. */
  cropRect: Box | null;

  gradientKind: PixelGradientKind;
  gradientOpacity: number;
  gradientReverse: boolean;
  /** Dégradé elliptique : petit axe / grand axe, en %. */
  gradientAspect: number;

  spongeMode: 'saturate' | 'desaturate';

  bgTolerance: number;
  bgContinuous: boolean;
  bgContiguous: boolean;
  floodTolerance: number;
  floodContiguous: boolean;
  replaceTolerance: number;
  replaceContinuous: boolean;

  /** Yeux rouges : assombrissement des pupilles, en %. */
  redEyeDarken: number;

  /** Correctif : la zone tracée est le défaut (source) ou le morceau à recopier (destination). */
  patchMode: 'source' | 'destination';
  /** Une zone du correctif est tracée. */
  patchRegion: boolean;

  /** Masque rapide : la sélection est montrée en rouge et se peint au pinceau. */
  quickMask: boolean;
}

export const pixelStore = new Store<PixelToolState>({
  cropRatio: 'free',
  cropW: 1200,
  cropH: 800,
  cropPortrait: false,
  cropOverlay: 'thirds',
  cropStraighten: false,
  cropAngle: 0,
  cropRect: null,
  gradientKind: 'linear',
  gradientOpacity: 100,
  gradientReverse: false,
  gradientAspect: 50,
  spongeMode: 'desaturate',
  bgTolerance: 40,
  bgContinuous: true,
  bgContiguous: false,
  floodTolerance: 32,
  floodContiguous: true,
  replaceTolerance: 48,
  replaceContinuous: true,
  redEyeDarken: 40,
  patchMode: 'source',
  patchRegion: false,
  quickMask: false,
});
