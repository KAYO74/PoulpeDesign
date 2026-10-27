import type { ToolId } from './store';

/*
 * Préréglages des touches d'outils : celles d'Affinity (par défaut), de Photoshop et d'Illustrator,
 * pour qu'on retrouve ses réflexes. Chaque préréglage dit les touches par Persona ; une Persona
 * absente garde les touches d'Affinity.
 */

export type KeyPreset = 'affinity' | 'photoshop' | 'illustrator';
export const KEY_PRESETS: KeyPreset[] = ['affinity', 'photoshop', 'illustrator'];

type Keys = Record<string, ToolId[]>;

export const PRESET_KEYS: Record<
  Exclude<KeyPreset, 'affinity'>,
  { draw: Keys; photo: Keys; layout: Keys }
> = {
  photoshop: {
    // Photoshop : tracés et formes (Plume P, Sélection de tracé A, Forme U, Texte T).
    draw: {
      v: ['select'],
      a: ['direct'],
      p: ['pen'],
      n: ['pencil'],
      b: ['vectorBrush'],
      u: ['rect', 'roundRect', 'ellipse', 'line'],
      c: ['corner'],
      k: ['knife'],
      g: ['gradient'],
      t: ['text', 'frameText'],
      i: ['eyedropper', 'stylePicker'],
      h: ['hand'],
      z: ['zoom'],
    },
    photo: {
      v: ['select'],
      m: ['marqueeRect', 'marqueeEllipse'],
      l: ['lasso'],
      w: ['quickSelect', 'magicWand'],
      c: ['crop', 'straighten'],
      i: ['eyedropper'],
      j: ['heal', 'patch', 'blemish', 'redEye', 'magicEraser'],
      b: ['brush', 'colorReplace'],
      s: ['clone'],
      e: ['eraser', 'backgroundEraser', 'floodEraser'],
      g: ['fill', 'pixelGradient'],
      r: ['blurBrush', 'sharpenBrush', 'smudge'],
      o: ['dodge', 'burn', 'sponge'],
      t: ['text', 'frameText'],
      h: ['hand'],
      z: ['zoom'],
    },
    layout: {
      v: ['select'],
      a: ['direct'],
      t: ['frameText', 'text', 'table'],
      f: ['pictureFrameRect', 'pictureFrameEllipse'],
      p: ['pen'],
      u: ['rect', 'roundRect', 'ellipse'],
      g: ['gradient'],
      i: ['eyedropper', 'stylePicker'],
      h: ['hand'],
      z: ['zoom'],
    },
  },
  illustrator: {
    // Illustrator : Sélection V, Sélection directe A, Plume P, Crayon N, Pinceau B, Rectangle M, Ellipse L.
    draw: {
      v: ['select'],
      a: ['direct'],
      p: ['pen'],
      n: ['pencil'],
      b: ['vectorBrush'],
      m: ['rect', 'roundRect'],
      l: ['ellipse'],
      c: ['scissors'],
      k: ['shapeBuilder'],
      o: ['contour'],
      w: ['strokeWidth'],
      g: ['gradient'],
      y: ['transparency'],
      t: ['text', 'frameText'],
      i: ['eyedropper', 'stylePicker'],
      h: ['hand'],
      z: ['zoom'],
    },
    photo: {
      v: ['select'],
      m: ['marqueeRect', 'marqueeEllipse'],
      l: ['lasso'],
      w: ['quickSelect', 'magicWand'],
      c: ['crop', 'straighten'],
      b: ['brush'],
      e: ['eraser', 'backgroundEraser', 'floodEraser'],
      g: ['fill', 'pixelGradient'],
      j: ['heal', 'patch', 'blemish', 'redEye', 'magicEraser'],
      s: ['clone'],
      o: ['dodge', 'burn', 'sponge'],
      t: ['text', 'frameText'],
      i: ['eyedropper'],
      h: ['hand'],
      z: ['zoom'],
    },
    layout: {
      v: ['select'],
      a: ['direct'],
      t: ['frameText', 'text', 'table'],
      p: ['pen'],
      m: ['rect', 'roundRect'],
      l: ['ellipse'],
      g: ['gradient'],
      i: ['eyedropper', 'stylePicker'],
      h: ['hand'],
      z: ['zoom'],
    },
  },
};
