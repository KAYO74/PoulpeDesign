/// <reference lib="webworker" />
// Import direct du module : le reste de @poulpe/core n'a rien à faire dans le worker.
import { fuseImages, type FusionOptions } from '@poulpe/core/src/fusion';

/* Fusion d'images hors du fil de l'interface ; annuler = fermer le worker. */
self.onmessage = (
  e: MessageEvent<{
    id: number;
    images: { data: Uint8ClampedArray; width: number; height: number }[];
    options: Omit<FusionOptions, 'progress'>;
  }>,
) => {
  const { id, images, options } = e.data;
  try {
    const result = fuseImages(images, {
      ...options,
      progress: (progress) => self.postMessage({ id, progress }),
    });
    self.postMessage({ id, result }, result ? [result.data.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
