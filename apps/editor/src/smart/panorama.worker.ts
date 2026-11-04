/// <reference lib="webworker" />
// Import direct du module : le reste de @poulpe/core n'a rien à faire dans le worker.
import { PanoramaError, stitchPanorama, type PanoramaOptions } from '@poulpe/core/src/panorama';

/* Assemblage de panorama hors du fil de l'interface ; annuler = fermer le worker. */
self.onmessage = (
  e: MessageEvent<{
    id: number;
    images: { data: Uint8ClampedArray; width: number; height: number }[];
    options: Omit<PanoramaOptions, 'progress'>;
  }>,
) => {
  const { id, images, options } = e.data;
  try {
    const result = stitchPanorama(images, {
      ...options,
      progress: (progress) => self.postMessage({ id, progress }),
    });
    self.postMessage({ id, result }, result ? [result.data.buffer] : []);
  } catch (err) {
    if (err instanceof PanoramaError)
      self.postMessage({ id, error: err.message, code: err.code, index: err.index });
    else self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
