import { isDesktop } from './io';

/**
 * Taille de l'interface (Préférences › Affichage). L'appli de bureau agrandit toute la fenêtre
 * comme le zoom d'un navigateur : menus, panneaux, textes et icônes grandissent ensemble.
 * Dans le navigateur, c'est son propre zoom (Ctrl + / Ctrl −) qui joue ce rôle.
 */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** Densité de l'écran avant tout agrandissement. */
const baseDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
/** Correction de netteté quand le moteur d'affichage n'augmente pas lui-même la densité (WebKit). */
let sharpness = 1;

/** Pixels réels par pixel CSS, pour dessiner les toiles nettement à toutes les tailles d'interface. */
export function renderDpr(): number {
  return (window.devicePixelRatio || 1) * sharpness;
}

export const uiScaleAvailable = (): boolean => isDesktop();

export async function applyUiScale(scale: number): Promise<void> {
  if (!isDesktop()) return;
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(scale);
  } catch {
    return;
  }
  await new Promise((r) => requestAnimationFrame(r));
  const dpr = window.devicePixelRatio || 1;
  sharpness = Math.abs(dpr - baseDpr * scale) < 0.05 ? 1 : scale;
  // Les toiles se redessinent avec la nouvelle densité.
  window.dispatchEvent(new Event('ui-scale'));
}
