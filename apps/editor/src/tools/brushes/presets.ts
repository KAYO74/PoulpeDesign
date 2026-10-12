import { brushSettings, setBrush, ui, type BrushSettings } from '../../store';
import { userPresets, type BrushPreset } from './state';

/*
 * Préréglages de pinceau (panneau Pinceau) : quelques pinceaux ronds fournis, et ceux que l'on
 * enregistre soi-même. Un préréglage s'applique à l'outil de peinture actif.
 */

/** Pinceaux fournis : le nom est une clé de traduction. */
export const DEFAULT_PRESETS: BrushPreset[] = [
  { id: 'hard', name: 'preset.hardRound', size: 20, hardness: 100, opacity: 100, flow: 100 },
  { id: 'medium', name: 'preset.mediumRound', size: 40, hardness: 60, opacity: 100, flow: 100 },
  { id: 'soft', name: 'preset.softRound', size: 80, hardness: 0, opacity: 100, flow: 100 },
  { id: 'detail', name: 'preset.detail', size: 4, hardness: 90, opacity: 100, flow: 100 },
  { id: 'airbrush', name: 'preset.airbrush', size: 120, hardness: 0, opacity: 100, flow: 8 },
  { id: 'wash', name: 'preset.wash', size: 300, hardness: 0, opacity: 40, flow: 30 },
];

/** Applique un préréglage à l'outil actif. */
export function applyPreset(p: BrushSettings): void {
  setBrush({ size: p.size, hardness: p.hardness, opacity: p.opacity, flow: p.flow });
}

/** Le pinceau de l'outil actif correspond-il à ce préréglage ? */
export function isCurrentPreset(p: BrushSettings, b: BrushSettings = brushSettings(ui.get().tool)): boolean {
  return b.size === p.size && b.hardness === p.hardness && b.opacity === p.opacity && b.flow === p.flow;
}

/** Enregistre le pinceau de l'outil actif sous un nom. */
export function saveCurrentPreset(name: string): void {
  const b = brushSettings(ui.get().tool);
  const id = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  userPresets.set((s) => ({
    list: [
      ...s.list,
      { id, name: name.trim(), size: b.size, hardness: b.hardness, opacity: b.opacity, flow: b.flow },
    ],
  }));
}

export function deletePreset(id: string): void {
  userPresets.set((s) => ({ list: s.list.filter((p) => p.id !== id) }));
}
