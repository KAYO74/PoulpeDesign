/*
 * IA connectées (Préférences › IA) : fournisseurs en ligne avec la clé API de l'utilisateur
 * (OpenAI, Anthropic, Google, Mistral…) ou modèles locaux (Ollama, LM Studio).
 *
 * La liste des fournisseurs est enregistrée sans les clés. Dans l'appli de bureau, les clés vont
 * dans le trousseau du système et les requêtes partent de Rust (src-tauri/src/ai.rs) : la clé ne
 * revient jamais dans l'interface. Dans le navigateur, elles sont chiffrées (keyVault.ts) dans le stockage de ce navigateur.
 */
import { useSyncExternalStore } from 'react';
import { isDesktop } from '../io';
import { isSealed, seal, unseal } from './keyVault';

/** Façon de parler au fournisseur. `openai` couvre tous les services compatibles (Ollama, LM Studio…). */
export type AiKind = 'openai' | 'anthropic' | 'google';

export interface AiProvider {
  id: string;
  name: string;
  kind: AiKind;
  baseUrl: string;
  /** Modèle de texte (assistant). */
  model: string;
  /** Modèle d'images ; vide si le fournisseur n'en génère pas. */
  imageModel: string;
  /** Local (sur l'ordinateur) : pas de clé. */
  local: boolean;
}

export interface AiPreset {
  id: string;
  name: string;
  kind: AiKind;
  baseUrl: string;
  model: string;
  imageModel: string;
  local: boolean;
}

/** Fournisseurs proposés dans « Ajouter ». Les modèles se changent ensuite (liste chargée du service). */
export const AI_PRESETS: AiPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    imageModel: 'gpt-image-1',
    local: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    imageModel: '',
    local: false,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
    local: false,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    imageModel: '',
    local: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    imageModel: '',
    local: false,
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: '',
    imageModel: '',
    local: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    imageModel: '',
    local: false,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    imageModel: '',
    local: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    imageModel: '',
    local: true,
  },
  {
    id: 'custom',
    name: 'Compatible OpenAI',
    kind: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    model: '',
    imageModel: '',
    local: false,
  },
];

interface AiState {
  providers: AiProvider[];
  /** Fournisseur utilisé par défaut pour le texte et pour les images. */
  textId: string | null;
  imageId: string | null;
}

const KEY = 'poulpe.ai';
const KEYS = 'poulpe.ai.keys';

function load(): AiState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AiState>;
    return {
      providers: Array.isArray(s.providers) ? s.providers : [],
      textId: s.textId ?? null,
      imageId: s.imageId ?? null,
    };
  } catch {
    return { providers: [], textId: null, imageId: null };
  }
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: AiState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible */
  }
  listeners.forEach((l) => l());
}

export const aiState = () => state;

export function useAi(): AiState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function addProvider(preset: AiPreset): AiProvider {
  const p: AiProvider = {
    id: `${preset.id}-${Date.now().toString(36)}`,
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    imageModel: preset.imageModel,
    local: preset.local,
  };
  commit({
    providers: [...state.providers, p],
    textId: state.textId ?? p.id,
    imageId: state.imageId ?? (p.imageModel ? p.id : null),
  });
  return p;
}

export function updateProvider(id: string, patch: Partial<AiProvider>) {
  commit({ ...state, providers: state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

export function removeProvider(id: string) {
  void deleteKey(id);
  const providers = state.providers.filter((p) => p.id !== id);
  const keep = (v: string | null) => (v === id ? (providers[0]?.id ?? null) : v);
  commit({ providers, textId: keep(state.textId), imageId: keep(state.imageId) });
}

export function setDefault(which: 'textId' | 'imageId', id: string) {
  commit({ ...state, [which]: id });
}

export const providerById = (id: string | null) => state.providers.find((p) => p.id === id) ?? null;

/* ——— Clés API ——— */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

/** Clés du navigateur : chiffrées dans le stockage local ; une ancienne clé en clair est chiffrée au passage. */
function storedKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

async function browserKey(id: string): Promise<string | null> {
  const value = storedKeys()[id];
  if (!value) return null;
  if (isSealed(value)) return unseal(value);
  await storeBrowserKey(id, value);
  return value;
}

async function storeBrowserKey(id: string, key: string): Promise<void> {
  localStorage.setItem(KEYS, JSON.stringify({ ...storedKeys(), [id]: await seal(key) }));
}

export async function saveKey(p: AiProvider, key: string): Promise<void> {
  if (isDesktop()) return invoke('ai_key_set', { id: p.id, url: p.baseUrl, key });
  await storeBrowserKey(p.id, key);
}

export async function hasKey(id: string): Promise<boolean> {
  if (isDesktop()) return invoke<boolean>('ai_key_has', { id }).catch(() => false);
  return !!storedKeys()[id];
}

async function deleteKey(id: string): Promise<void> {
  if (isDesktop()) return invoke<void>('ai_key_delete', { id }).catch(() => undefined);
  const keys = storedKeys();
  delete keys[id];
  localStorage.setItem(KEYS, JSON.stringify(keys));
}

/* ——— Requêtes ——— */

export interface AiFetch {
  url: string;
  method?: 'GET' | 'POST';
  headers?: [string, string][];
  body?: unknown;
  /** Où mettre la clé du fournisseur. */
  key?: { id: string; header: string; prefix?: string };
  /** Réponse binaire, rendue en base64. */
  binary?: boolean;
}

export interface AiReply {
  status: number;
  body: string;
}

export async function aiFetch(req: AiFetch): Promise<AiReply> {
  const body = req.body === undefined ? undefined : JSON.stringify(req.body);
  if (isDesktop()) {
    return invoke<AiReply>('ai_fetch', {
      req: {
        url: req.url,
        method: req.method,
        headers: req.headers ?? [],
        body,
        key: req.key,
        binary: !!req.binary,
      },
    });
  }
  const headers = new Headers(req.headers ?? []);
  if (body) headers.set('content-type', 'application/json');
  if (req.key) {
    const k = await browserKey(req.key.id);
    if (!k) throw new Error('no key');
    headers.set(req.key.header, (req.key.prefix ?? '') + k);
  }
  const res = await fetch(req.url, { method: req.method ?? 'GET', headers, body });
  if (!req.binary) return { status: res.status, body: await res.text() };
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { status: res.status, body: btoa(bin) };
}
