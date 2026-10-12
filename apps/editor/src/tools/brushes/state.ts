import type { BlendMode, ToneRange } from '@poulpe/core';
import { Store, setTool, ui, type BrushSettings } from '../../store';

/*
 * Réglages des pinceaux et des sélections de la Persona Photo ajoutés en version 1.2 (comme dans
 * Affinity Photo). Ils sont gardés d'une session à l'autre, comme les préréglages de pinceau.
 */

/** Lasso : à main levée, polygonal (clic après clic) ou magnétique (il suit les bords). */
export type LassoMode = 'freehand' | 'polygonal' | 'magnetic';
/** Pixels où la baguette magique et le pot de peinture cherchent les couleurs proches. */
export type SampleSource = 'layer' | 'all';
/** Pixels recopiés par le tampon et le correcteur. */
export type CloneSource = 'layer' | 'layerBelow' | 'below';

export interface BrushOptions {
  /** Stabilisateur du tracé : corde (longueur en pixels d'écran) ou fenêtre (nombre de positions). */
  stabilizer: boolean;
  stabilizerMode: 'rope' | 'window';
  ropeLength: number;
  windowSize: number;
  /** Pinceau : mode de fusion de la peinture, et peinture seulement sur les pixels existants. */
  blend: BlendMode;
  protectAlpha: boolean;
  /** Pot de peinture : mode de fusion et pixels comparés. */
  fillBlend: BlendMode;
  fillSource: SampleSource;
  /** Éclaircir et Assombrir. */
  toneRange: ToneRange;
  protectHue: boolean;
  /** Tampon et correcteur : décalage gardé d'un coup à l'autre, et pixels recopiés. */
  aligned: boolean;
  cloneSource: CloneSource;
  /** Tampon : rotation (degrés) et échelle (%) de la source recopiée. */
  cloneRotation: number;
  cloneScale: number;
  /** Rectangle et ellipse de sélection : tracé depuis le centre, bord lissé. */
  fromCenter: boolean;
  antialias: boolean;
  lassoMode: LassoMode;
  /** Lasso magnétique : largeur de la bande où l'on cherche le bord (pixels d'écran). */
  magneticWidth: number;
  wandSource: SampleSource;
}

/** Préréglage de pinceau (panneau Pinceaux). */
export interface BrushPreset extends BrushSettings {
  id: string;
  /** Nom saisi (préréglages enregistrés) ou clé de traduction (préréglages fournis). */
  name: string;
}

const DEFAULTS: BrushOptions = {
  stabilizer: false,
  stabilizerMode: 'rope',
  ropeLength: 30,
  windowSize: 10,
  blend: 'normal',
  protectAlpha: false,
  fillBlend: 'normal',
  fillSource: 'layer',
  toneRange: 'midtones',
  protectHue: false,
  aligned: true,
  cloneSource: 'layer',
  cloneRotation: 0,
  cloneScale: 100,
  fromCenter: false,
  antialias: true,
  lassoMode: 'freehand',
  magneticWidth: 10,
  wandSource: 'all',
};

const KEY = 'poulpe.brushOptions';
const PRESETS_KEY = 'poulpe.brushPresets';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

export const brushOptions = new Store<BrushOptions>({ ...DEFAULTS, ...load<Partial<BrushOptions>>(KEY, {}) });
brushOptions.subscribe(() => save(KEY, brushOptions.get()));

/** Préréglages enregistrés par l'utilisateur (ceux fournis sont dans presets.ts). */
export const userPresets = new Store<{ list: BrushPreset[] }>({
  list: (() => {
    const l = load<BrushPreset[]>(PRESETS_KEY, []);
    return Array.isArray(l) ? l : [];
  })(),
});
userPresets.subscribe(() => save(PRESETS_KEY, userPresets.get().list));

/*
 * L'ancien outil Lasso polygonal est devenu un mode du lasso (comme dans Affinity). Un espace de
 * travail personnalisé peut encore le proposer : le choisir donne le lasso en mode polygonal.
 */
ui.subscribe(() => {
  if (ui.get().tool !== 'polyLasso') return;
  brushOptions.set({ lassoMode: 'polygonal' });
  setTool('lasso');
});
