import {
  findArtboard,
  findNode,
  newId,
  nodeBounds,
  type Artboard,
  type PoulpeDocument,
  type Slice,
  type SliceExport,
} from '@poulpe/core';
import { t } from './i18n';
import { artboardBytes, safeName, saveBytes } from './io';
import { editor, toast } from './store';

/*
 * Persona Export (comme celle d'Affinity) : des tranches, chacune un calque, un plan de travail
 * ou une zone, avec leurs formats (PNG 1x, 2x, 3x, JPEG, SVG, PDF). « Exporter les tranches »
 * fait tous les fichiers d'un coup, réunis dans un ZIP.
 */

/** Formats proposés pour chaque tranche, dans l'ordre des boutons. */
export const SLICE_PRESETS: SliceExport[] = [
  { format: 'png', scale: 1 },
  { format: 'png', scale: 2 },
  { format: 'png', scale: 3 },
  { format: 'jpeg', scale: 1 },
  { format: 'svg', scale: 1 },
  { format: 'pdf', scale: 1 },
];

export const presetLabel = (e: SliceExport): string =>
  e.format === 'png' || e.format === 'jpeg'
    ? `${e.format.toUpperCase()} ${e.scale}x`
    : e.format.toUpperCase();

const sameExport = (a: SliceExport, b: SliceExport) => a.format === b.format && a.scale === b.scale;

/** Une tranche par calque sélectionné (sa zone suivra le calque). */
export function slicesFromSelection(): void {
  const doc = editor.doc;
  const added: Slice[] = [];
  for (const id of editor.selection) {
    const loc = findNode(doc, id);
    if (!loc || doc.slices?.some((s) => s.layerId === id)) continue;
    added.push({
      id: newId('slc'),
      name: loc.node.name,
      artboardId: loc.artboard.id,
      layerId: id,
      exports: [{ format: 'png', scale: 1 }],
    });
  }
  if (added.length)
    editor.apply('history.addSlices', (d) => void (d.slices = [...(d.slices ?? []), ...added]));
}

/** Une tranche par plan de travail (pages maîtres exclues). */
export function slicesFromArtboards(): void {
  const doc = editor.doc;
  const added: Slice[] = doc.artboards
    .filter((ab) => !ab.master && !doc.slices?.some((s) => s.artboardId === ab.id && !s.layerId && !s.rect))
    .map((ab) => ({
      id: newId('slc'),
      name: ab.name,
      artboardId: ab.id,
      exports: [{ format: 'png', scale: 1 }],
    }));
  if (added.length)
    editor.apply('history.addSlices', (d) => void (d.slices = [...(d.slices ?? []), ...added]));
}

export function updateSlice(id: string, fn: (s: Slice) => void): void {
  editor.apply('history.slice', (d) => {
    const s = d.slices?.find((x) => x.id === id);
    if (s) fn(s);
  });
}

export function toggleSliceExport(id: string, e: SliceExport): void {
  updateSlice(id, (s) => {
    const on = s.exports.some((x) => sameExport(x, e));
    s.exports = on ? s.exports.filter((x) => !sameExport(x, e)) : [...s.exports, { ...e }];
  });
}

export function removeSlice(id: string): void {
  editor.apply('history.removeSlice', (d) => {
    d.slices = d.slices?.filter((s) => s.id !== id);
    if (!d.slices?.length) delete d.slices;
  });
}

/** Plan de travail à exporter pour une tranche : celui du document, recadré sur la tranche. */
export function sliceArtboard(doc: PoulpeDocument, s: Slice): Artboard | null {
  const ab = findArtboard(doc, s.artboardId);
  if (!ab) return null;
  if (s.layerId) {
    const node = findNode(doc, s.layerId)?.node;
    if (!node) return null;
    const b = nodeBounds(node);
    // Le calque seul, sur fond transparent : comme l'export d'un calque dans Affinity.
    return {
      ...ab,
      x: b.x,
      y: b.y,
      width: Math.max(1, b.width),
      height: Math.max(1, b.height),
      background: { type: 'none' },
      children: [node],
    };
  }
  if (s.rect) return { ...ab, ...s.rect };
  return ab;
}

/** Nombre de fichiers que l'export des tranches va produire. */
export const sliceFileCount = (doc: PoulpeDocument): number =>
  (doc.slices ?? []).reduce((n, s) => n + s.exports.length, 0);

/** Exporte toutes les tranches dans tous leurs formats, réunies dans un ZIP. */
export async function exportSlices(): Promise<void> {
  const doc = editor.doc;
  const slices = doc.slices ?? [];
  if (!sliceFileCount(doc)) {
    toast(t('slices.nothing'));
    return;
  }
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const s of slices) {
    const ab = sliceArtboard(doc, s);
    if (!ab) continue;
    for (const e of s.exports) {
      const bytes = await artboardBytes(doc, ab, e.format, {
        scale: e.scale,
        quality: 0.9,
        transparent: e.format !== 'jpeg',
      });
      const suffix = e.scale !== 1 ? `@${e.scale}x` : '';
      let name = `${safeName(s.name)}${suffix}.${e.format === 'jpeg' ? 'jpg' : e.format}`;
      for (let i = 2; files[name]; i++) name = `${safeName(s.name)} (${i})${suffix}.${e.format}`;
      files[name] = bytes;
    }
  }
  const zip = zipSync(files, { level: 0 });
  if (await saveBytes(zip, 'zip', `${doc.name} - tranches`))
    toast(t('export.batchDone', { n: Object.keys(files).length }));
}
