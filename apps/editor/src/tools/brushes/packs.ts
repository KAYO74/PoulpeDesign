import { Store } from '../../store';
import { userPresets, type BrushPreset } from './state';
import {
  addTips,
  brushTips,
  deleteTip,
  parseAbr,
  tipFromImageFile,
  tipFromMask,
  type BrushTip,
} from './tips';

/*
 * Partage de pinceaux (version 1.2.9) : un paquet de pinceaux (`.poulpebrushes`) réunit des
 * préréglages et leurs formes. On l'installe comme une extension (panneau Pinceau, ou Extensions ›
 * Gérer les extensions…), et on le désinstalle d'un clic. Les pinceaux Photoshop (.abr) et, si
 * possible, Affinity (.afbrushes) s'installent de la même façon.
 */

export const PACK_EXTENSION = 'poulpebrushes';
const FORMAT = 'poulpe-brushes';

/** Contenu d'un fichier `.poulpebrushes` (JSON). */
export interface BrushPackFile {
  format: typeof FORMAT;
  version: 1;
  name: string;
  author?: string;
  presets: BrushPreset[];
  tips: BrushTip[];
}

/** Paquet installé : ce qu'il a ajouté, pour le retirer. */
export interface InstalledPack {
  id: string;
  name: string;
  author?: string;
  presetIds: string[];
  tipIds: string[];
}

const KEY = 'poulpe.brushPacks';

function load(): InstalledPack[] {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? '[]') as InstalledPack[];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export const brushPacks = new Store<{ list: InstalledPack[] }>({ list: load() });
brushPacks.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(brushPacks.get().list));
  } catch {
    /* stockage indisponible */
  }
});

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Fichier de partage des pinceaux enregistrés (tous, ou ceux donnés), avec leurs formes. */
export function exportPack(name: string, author?: string, presetIds?: string[]): BrushPackFile {
  const presets = userPresets.get().list.filter((p) => !presetIds || presetIds.includes(p.id));
  const used = new Set(presets.map((p) => p.tip).filter(Boolean));
  const tips = brushTips.get().list.filter((t) => used.has(t.id));
  return { format: FORMAT, version: 1, name, ...(author ? { author } : {}), presets, tips };
}

export function packBytes(pack: BrushPackFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(pack));
}

function isPackFile(v: unknown): v is BrushPackFile {
  const p = v as BrushPackFile;
  return !!p && p.format === FORMAT && Array.isArray(p.presets) && Array.isArray(p.tips);
}

const num = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const opt = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;

/** Installe un paquet : formes et préréglages reçoivent de nouveaux identifiants (pas de collision). */
export function installPack(pack: BrushPackFile): InstalledPack {
  const tipIds = new Map<string, string>();
  const tips: BrushTip[] = [];
  const known = new Set(brushTips.get().list.map((t) => t.id));
  for (const t of pack.tips) {
    if (typeof t?.data !== 'string' || !t.data.startsWith('data:image/')) continue;
    // Une forme qui vient d'être lue garde son identifiant (elle est déjà décodée).
    const id =
      typeof t.id === 'string' && /^tip-[a-z0-9]+$/.test(t.id) && !known.has(t.id) ? t.id : uid('tip');
    tipIds.set(t.id, id);
    tips.push({
      id,
      name: String(t.name ?? ''),
      data: t.data,
      w: num(t.w, 1, 4096, 1),
      h: num(t.h, 1, 4096, 1),
    });
  }
  const presets: BrushPreset[] = pack.presets.map((p) => ({
    id: uid('user'),
    name: String(p?.name ?? pack.name).slice(0, 80),
    size: num(p?.size, 1, 1000, 20),
    hardness: num(p?.hardness, 0, 100, 80),
    opacity: num(p?.opacity, 1, 100, 100),
    flow: num(p?.flow, 1, 100, 100),
    tip: p?.tip ? tipIds.get(p.tip) : undefined,
    spacing: opt(p?.spacing, 1, 200),
    angle: opt(p?.angle, -180, 180),
    roundness: opt(p?.roundness, 1, 100),
    sizeJitter: opt(p?.sizeJitter, 0, 100),
    angleJitter: opt(p?.angleJitter, 0, 180),
    scatter: opt(p?.scatter, 0, 200),
  }));
  addTips(tips);
  userPresets.set((s) => ({ list: [...s.list, ...presets] }));
  const installed: InstalledPack = {
    id: uid('pack'),
    name: String(pack.name || 'Pinceaux').slice(0, 80),
    ...(pack.author ? { author: String(pack.author).slice(0, 80) } : {}),
    presetIds: presets.map((p) => p.id),
    tipIds: tips.map((t) => t.id),
  };
  brushPacks.set((s) => ({ list: [...s.list, installed] }));
  return installed;
}

/** Retire un paquet : ses préréglages et ses formes. */
export function uninstallPack(id: string): void {
  const pack = brushPacks.get().list.find((p) => p.id === id);
  if (!pack) return;
  userPresets.set((s) => ({ list: s.list.filter((p) => !pack.presetIds.includes(p.id)) }));
  pack.tipIds.forEach(deleteTip);
  brushPacks.set((s) => ({ list: s.list.filter((p) => p.id !== id) }));
}

/** Un préréglage par forme : pinceau importé prêt à l'emploi. */
function packOfTips(name: string, tips: BrushTip[]): BrushPackFile {
  return {
    format: FORMAT,
    version: 1,
    name,
    tips,
    presets: tips.map((t) => ({
      id: t.id,
      name: t.name,
      size: Math.min(300, Math.max(t.w, t.h)),
      hardness: 100,
      opacity: 100,
      flow: 100,
      tip: t.id,
      spacing: 25,
    })),
  };
}

/**
 * Pinceaux Affinity (.afbrushes) : le format n'est pas publié. Les formes y sont des images PNG,
 * qu'on retrouve par leur signature ; les autres réglages ne sont pas lus.
 */
export async function tipsFromAfBrushes(bytes: Uint8Array, base: string): Promise<BrushTip[]> {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const IEND = [0x49, 0x45, 0x4e, 0x44];
  const tips: BrushTip[] = [];
  for (let i = 0; i + 8 < bytes.length && tips.length < 500; i++) {
    if (!SIG.every((b, k) => bytes[i + k] === b)) continue;
    let end = -1;
    for (let j = i + 8; j + 8 <= bytes.length; j++)
      if (IEND.every((b, k) => bytes[j + k] === b)) {
        end = j + 8;
        break;
      }
    if (end < 0) break;
    try {
      const tip = await tipFromImageFile(
        new Blob([bytes.slice(i, end)], { type: 'image/png' }),
        `${base} ${tips.length + 1}`,
      );
      if (tip) tips.push(tip);
    } catch {
      /* image illisible : on passe */
    }
    i = end - 1;
  }
  return tips;
}

/**
 * Installe un fichier de pinceaux : `.poulpebrushes`, Photoshop `.abr` ou Affinity `.afbrushes`.
 * Rend le paquet installé, ou null si le fichier ne contient aucun pinceau lisible.
 */
export async function installBrushFile(name: string, bytes: Uint8Array): Promise<InstalledPack | null> {
  const ext = name.split('.').pop()!.toLowerCase();
  const base = name
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '');
  if (ext === PACK_EXTENSION) {
    try {
      const pack = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      return isPackFile(pack) ? installPack(pack) : null;
    } catch {
      return null;
    }
  }
  let tips: BrushTip[] = [];
  if (ext === 'abr') {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    tips = parseAbr(buf)
      .map((t, i) => tipFromMask(t.mask, t.w, t.h, `${base} ${i + 1}`))
      .filter((t): t is BrushTip => !!t);
  } else if (ext === 'afbrushes') tips = await tipsFromAfBrushes(bytes, base);
  return tips.length ? installPack(packOfTips(base, tips)) : null;
}

/** Choisit un fichier de pinceaux et l'installe ; rend le paquet, ou null (annulé ou illisible). */
export async function pickAndInstallBrushes(): Promise<InstalledPack | null | undefined> {
  const { pickFile } = await import('../../io');
  const file = await pickFile([PACK_EXTENSION, 'abr', 'afbrushes'], `.${PACK_EXTENSION},.abr,.afbrushes`);
  if (!file) return undefined;
  return installBrushFile(file.name, file.bytes);
}

/** Enregistre les pinceaux de l'utilisateur dans un fichier à partager. */
export async function sharePresets(name: string): Promise<string | null> {
  const { saveBytes } = await import('../../io');
  return saveBytes(packBytes(exportPack(name)), 'brushes', name);
}
