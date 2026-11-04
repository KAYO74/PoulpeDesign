import { boxCenter } from './geometry';
import { rotateNode, scaleNode, translateNode } from './tree';
import type { AnimationKind, Artboard, NodeAnimation, SceneNode } from './types';

/*
 * Animation simple (comme les animations d'entrée de Canva) : chaque objet peut apparaître en
 * fondu, en montant, en glissant, en zoomant, en rebondissant ou en tournant, avec un délai et une
 * durée. Le document garde l'état final : l'animation n'existe qu'à la lecture et à l'export GIF.
 */

export const ANIMATION_KINDS: AnimationKind[] = ['fade', 'rise', 'slide', 'zoom', 'pop', 'spin'];

export function defaultAnimation(kind: AnimationKind = 'fade'): NodeAnimation {
  return { kind, delay: 0, duration: 0.6 };
}

/** Animation lue dans un fichier : connue et aux nombres sensés, sinon ignorée. */
export function validAnimation(a: unknown): NodeAnimation | null {
  if (!a || typeof a !== 'object') return null;
  const { kind, delay, duration } = a as NodeAnimation;
  if (!ANIMATION_KINDS.includes(kind)) return null;
  if (!Number.isFinite(delay) || !Number.isFinite(duration)) return null;
  return { kind, delay: Math.min(60, Math.max(0, delay)), duration: Math.min(60, Math.max(0.05, duration)) };
}

/** Objets animés du plan de travail (groupes compris), dans l'ordre du dessin. */
function animated(nodes: SceneNode[], out: SceneNode[] = []): SceneNode[] {
  for (const n of nodes) {
    if (validAnimation(n.animation)) out.push(n);
    if (n.type === 'group') animated(n.children, out);
  }
  return out;
}

/** Le plan de travail a au moins un objet animé. */
export function hasAnimation(ab: Artboard): boolean {
  return animated(ab.children).length > 0;
}

/** Durée de l'animation du plan de travail en secondes (0 sans animation). */
export function animationLength(ab: Artboard): number {
  let end = 0;
  for (const n of animated(ab.children)) {
    const a = validAnimation(n.animation)!;
    end = Math.max(end, a.delay + a.duration);
  }
  return end;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Dépasse un peu la fin puis revient (rebond). */
const backOut = (p: number) => {
  const s = 1.7;
  const q = p - 1;
  return 1 + q * q * ((s + 1) * q + s);
};

/** Avancement (0 à 1) d'une animation au temps t (secondes). */
export function animationProgress(a: NodeAnimation, t: number): number {
  if (t <= a.delay) return 0;
  return Math.min(1, (t - a.delay) / Math.max(0.0001, a.duration));
}

/** Applique l'état d'un objet au temps t (sur une copie). */
function pose(n: SceneNode, a: NodeAnimation, t: number, ab: Artboard): void {
  const p = animationProgress(a, t);
  if (p >= 1) return;
  const e = easeOut(p);
  const c = boxCenter(n);
  switch (a.kind) {
    case 'fade':
      n.opacity *= e;
      break;
    case 'rise':
      n.opacity *= e;
      translateNode(n, 0, (1 - e) * Math.max(40, ab.height * 0.08));
      break;
    case 'slide':
      n.opacity *= e;
      translateNode(n, -(1 - e) * Math.max(60, ab.width * 0.15), 0);
      break;
    case 'zoom': {
      n.opacity *= e;
      const k = 0.4 + 0.6 * e;
      scaleNode(n, k, k, c, true);
      break;
    }
    case 'pop': {
      const k = Math.max(0.001, backOut(p));
      n.opacity *= Math.min(1, p * 3);
      scaleNode(n, k, k, c, true);
      break;
    }
    case 'spin': {
      n.opacity *= e;
      rotateNode(n, -(1 - e) * 180, c);
      const k = 0.5 + 0.5 * e;
      scaleNode(n, k, k, c, true);
      break;
    }
  }
}

/**
 * Plan de travail tel qu'il apparaît au temps t (secondes), sur une copie : les objets dont
 * l'animation n'a pas commencé sont invisibles, ceux qui s'animent sont dans leur état du moment.
 */
export function animateArtboard(ab: Artboard, t: number): Artboard {
  const copy = structuredClone(ab) as Artboard;
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      const a = validAnimation(n.animation);
      if (a) pose(n, a, t, copy);
      if (n.type === 'group') visit(n.children);
    }
  };
  visit(copy.children);
  return copy;
}
