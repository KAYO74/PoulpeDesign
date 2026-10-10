import { useSyncExternalStore } from 'react';
import { findNode, newId } from '@poulpe/core';
import { nudge } from '../actions';
import { findCommand } from '../commands';
import { registerCommand, unregisterCommand } from '../registry';
import { t } from '../i18n';
import { pickFile, saveBytes } from '../io';
import { addAdjustment, applyFilter } from '../photo/photoActions';
import { selectedImage } from '../photo/pixels';
import { modifySelection } from '../photo/selection';
import { insertTrace, traceAsync, traceSource } from '../smart/vectorize';
import { editor, toast } from '../store';
import { offsetPath } from '../vectorActions';
import { runExtensionCommand } from '../extensions/host';
import {
  isRecording,
  recordedSteps,
  startRecording,
  stopRecording,
  subscribeRecorder,
  withoutRecording,
  type MacroStep,
} from './recorder';

/*
 * Macros (comme le panneau Macros d'Affinity Photo ou les Actions de Photoshop) : une suite
 * d'actions enregistrée une fois, rejouée d'un clic ou d'un raccourci sur une autre image ou un
 * autre objet. Les macros sont gardées dans le navigateur ou l'appli, et s'échangent en fichiers
 * `.poulpemacro`.
 */

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

const KEY = 'poulpe.macros';
const FILE_FORMAT = 'poulpe-macro';
let macros: Macro[] = load();
const listeners = new Set<() => void>();

function load(): Macro[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isMacro) : [];
  } catch {
    return [];
  }
}

function isMacro(m: unknown): m is Macro {
  const o = m as Macro;
  return !!o && typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.steps);
}

function changed(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(macros));
  } catch {
    /* stockage indisponible */
  }
  syncCommands();
  listeners.forEach((l) => l());
}

/** Chaque macro est aussi une commande : on peut lui donner un raccourci. */
function syncCommands(): void {
  unregisterCommand('macro:');
  for (const m of macros)
    registerCommand(`macro:${m.id}`, { label: 'macro.play', title: m.name, run: () => playMacro(m.id) });
}
syncCommands();

export function getMacros(): Macro[] {
  return macros;
}

export function useMacros(): { macros: Macro[]; recording: boolean; recorded: number } {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => macros,
  );
  const recording = useSyncExternalStore(subscribeRecorder, isRecording);
  const recorded = useSyncExternalStore(subscribeRecorder, () => recordedSteps().length);
  return { macros: list, recording, recorded };
}

export function beginRecording(): void {
  startRecording();
}

/** Arrête l'enregistrement et garde la macro (s'il y a au moins une étape). */
export function endRecording(name?: string): Macro | null {
  const steps = stopRecording();
  if (!steps.length) {
    toast(t('macro.empty'));
    return null;
  }
  // Les calques de réglage gardent les réglages faits après leur création.
  for (const s of steps)
    if (s.kind === 'adjustment' && s.nodeId) {
      const n = findNode(editor.doc, s.nodeId)?.node;
      if (n?.type === 'adjustment') s.adjustment = structuredClone(n.adjustment);
      delete s.nodeId;
    }
  const macro: Macro = {
    id: newId('macro'),
    name: name || t('macro.defaultName', { n: macros.length + 1 }),
    steps,
  };
  macros = [...macros, macro];
  changed();
  return macro;
}

export function cancelRecording(): void {
  stopRecording();
}

export function renameMacro(id: string, name: string): void {
  macros = macros.map((m) => (m.id === id ? { ...m, name: name.trim() || m.name } : m));
  changed();
}

export function deleteMacro(id: string): void {
  macros = macros.filter((m) => m.id !== id);
  changed();
}

export function removeStep(id: string, index: number): void {
  macros = macros.map((m) => (m.id === id ? { ...m, steps: m.steps.filter((_, i) => i !== index) } : m));
  changed();
}

/** Texte d'une étape, pour la liste du panneau. */
export function stepLabel(s: MacroStep): string {
  switch (s.kind) {
    case 'command': {
      const cmd = findCommand(s.id);
      return cmd ? (cmd.title ?? t(cmd.label)) : s.id;
    }
    case 'filter':
      return t('macro.step.filter', { name: t(`adjust.${s.adjustment.kind}`) });
    case 'adjustment':
      return t('macro.step.adjustment', { name: t(`adjust.${s.adjustment.kind}`) });
    case 'offset':
      return t('macro.step.offset', { n: s.distance });
    case 'selectionModify':
      return `${t(`selmod.${s.mode}`)} (${s.radius} px)`;
    case 'nudge':
      return t('macro.step.nudge', { dx: s.dx, dy: s.dy });
    case 'vectorize':
      return t('image.vectorize').replace('…', '');
    case 'extension':
      return t('macro.step.extension', { name: s.command });
  }
}

async function playStep(s: MacroStep): Promise<boolean> {
  switch (s.kind) {
    case 'command': {
      const cmd = findCommand(s.id);
      if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
      await cmd.run();
      return true;
    }
    case 'filter': {
      const before = editor.getState().history.length;
      await applyFilter(s.adjustment);
      return editor.getState().history.length !== before;
    }
    case 'adjustment':
      addAdjustment(s.adjustment.kind, structuredClone(s.adjustment));
      return true;
    case 'offset':
      if (!editor.selection.length) return false;
      offsetPath(s.distance, s.join);
      return true;
    case 'selectionModify':
      modifySelection(s.mode, s.radius);
      return true;
    case 'nudge':
      if (!editor.selection.length) return false;
      nudge(s.dx, s.dy);
      return true;
    case 'vectorize': {
      const node = selectedImage();
      const px = node && traceSource(node, s.maxSide);
      if (!node || !px) return false;
      return insertTrace(node.id, await traceAsync(px, s.options), s.original) !== null;
    }
    case 'extension':
      return runExtensionCommand(s.extension, s.command, s.params);
  }
}

let playing = false;

/** Rejoue une macro sur la sélection en cours. Les étapes impossibles ici sont sautées. */
export async function playMacro(id: string): Promise<void> {
  const macro = macros.find((m) => m.id === id);
  if (!macro || playing) return;
  playing = true;
  let skipped = 0;
  try {
    await withoutRecording(async () => {
      for (const s of macro.steps) {
        try {
          if (!(await playStep(s))) skipped++;
        } catch (e) {
          console.error(e);
          skipped++;
        }
      }
    });
  } finally {
    playing = false;
  }
  toast(
    skipped
      ? t('macro.playedSkipped', { name: macro.name, n: skipped })
      : t('macro.played', { name: macro.name }),
  );
}

/** Enregistre une macro dans un fichier `.poulpemacro` pour la partager. */
export async function exportMacro(id: string): Promise<void> {
  const macro = macros.find((m) => m.id === id);
  if (!macro) return;
  const json = JSON.stringify(
    { format: FILE_FORMAT, version: 1, name: macro.name, steps: macro.steps },
    null,
    2,
  );
  await saveBytes(new TextEncoder().encode(json), 'macro', macro.name);
}

/** Ajoute les macros d'un fichier `.poulpemacro`. */
export async function importMacro(): Promise<void> {
  const file = await pickFile(['poulpemacro', 'json'], '.poulpemacro,application/json');
  if (!file) return;
  try {
    const data = JSON.parse(new TextDecoder().decode(file.bytes));
    if (data?.format !== FILE_FORMAT || !Array.isArray(data.steps)) throw new Error('format');
    const steps = (data.steps as MacroStep[]).filter((s) => s && typeof s.kind === 'string');
    macros = [...macros, { id: newId('macro'), name: String(data.name ?? 'Macro'), steps }];
    changed();
    toast(t('macro.imported', { name: String(data.name ?? 'Macro') }));
  } catch {
    toast(t('macro.invalid'));
  }
}
