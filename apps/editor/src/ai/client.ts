/*
 * Appels aux IA connectées : liste des modèles, discussion (assistant) et génération d'images,
 * pour les trois façons de parler aux fournisseurs (compatible OpenAI, Anthropic, Google).
 */
import { aiFetch, hasKey, type AiFetch, type AiProvider } from './providers';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM =
  'You are the assistant built into Poulpe Design, a free graphic design app (vector drawing, photo editing, page layout). Answer briefly, in the language of the user.';

const join = (base: string, path: string) => base.replace(/\/+$/, '') + path;

async function call(p: AiProvider, req: Omit<AiFetch, 'key'>): Promise<unknown> {
  const withKey = await hasKey(p.id);
  const key: AiFetch['key'] = !withKey
    ? undefined
    : p.kind === 'anthropic'
      ? { id: p.id, header: 'x-api-key' }
      : p.kind === 'google'
        ? { id: p.id, header: 'x-goog-api-key' }
        : { id: p.id, header: 'Authorization', prefix: 'Bearer ' };
  if (!withKey && !p.local && p.kind !== 'openai') throw new Error('missing-key');
  const headers: [string, string][] = [...(req.headers ?? [])];
  if (p.kind === 'anthropic') {
    headers.push(['anthropic-version', '2023-06-01']);
    // Requête directe depuis le navigateur (version web) : autorisée par Anthropic avec cet en-tête.
    headers.push(['anthropic-dangerous-direct-browser-access', 'true']);
  }
  const res = await aiFetch({ ...req, headers, key });
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    data = res.body;
  }
  if (res.status < 200 || res.status >= 300) throw new Error(errorText(data) || `HTTP ${res.status}`);
  return data;
}

function errorText(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 300);
  const e = (data as { error?: unknown })?.error;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown })?.message;
  return typeof m === 'string' ? m : '';
}

/** Modèles proposés par le fournisseur (sert aussi à tester la connexion). */
export async function listModels(p: AiProvider): Promise<string[]> {
  if (p.kind === 'google') {
    const d = (await call(p, { url: join(p.baseUrl, '/models?pageSize=200') })) as {
      models?: { name: string }[];
    };
    return (d.models ?? []).map((m) => m.name.replace(/^models\//, '')).sort();
  }
  const d = (await call(p, { url: join(p.baseUrl, '/models') })) as { data?: { id: string }[] };
  return (d.data ?? []).map((m) => m.id).sort();
}

async function modelOf(p: AiProvider, which: 'model' | 'imageModel'): Promise<string> {
  if (p[which]) return p[which];
  const first = (await listModels(p))[0];
  if (!first) throw new Error('no-model');
  return first;
}

/** Réponse de l'assistant à la conversation. */
export async function chat(p: AiProvider, messages: ChatMessage[]): Promise<string> {
  const model = await modelOf(p, 'model');
  if (p.kind === 'anthropic') {
    const d = (await call(p, {
      url: join(p.baseUrl, '/messages'),
      method: 'POST',
      body: { model, max_tokens: 2048, system: SYSTEM, messages },
    })) as { content?: { type: string; text?: string }[] };
    return (d.content ?? []).map((c) => c.text ?? '').join('');
  }
  if (p.kind === 'google') {
    const d = (await call(p, {
      url: join(p.baseUrl, `/models/${encodeURIComponent(model)}:generateContent`),
      method: 'POST',
      body: {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        })),
      },
    })) as GoogleReply;
    return googleParts(d)
      .map((x) => x.text ?? '')
      .join('');
  }
  const d = (await call(p, {
    url: join(p.baseUrl, '/chat/completions'),
    method: 'POST',
    body: { model, messages: [{ role: 'system', content: SYSTEM }, ...messages] },
  })) as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content ?? '';
}

interface GoogleReply {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] };
  }[];
}
const googleParts = (d: GoogleReply) => d.candidates?.[0]?.content?.parts ?? [];

export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Image générée : octets et type (PNG le plus souvent). */
export async function generateImage(
  p: AiProvider,
  prompt: string,
  size: ImageSize,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const model = await modelOf(p, 'imageModel');
  if (p.kind === 'google') {
    const d = (await call(p, {
      url: join(p.baseUrl, `/models/${encodeURIComponent(model)}:generateContent`),
      method: 'POST',
      body: { contents: [{ parts: [{ text: prompt }] }] },
    })) as GoogleReply;
    const img = googleParts(d).find((x) => x.inlineData)?.inlineData;
    if (!img) throw new Error('no-image');
    return { bytes: fromBase64(img.data), mime: img.mimeType };
  }
  if (p.kind !== 'openai') throw new Error('no-image');
  const d = (await call(p, {
    url: join(p.baseUrl, '/images/generations'),
    method: 'POST',
    body: { model, prompt, size, n: 1 },
  })) as { data?: { b64_json?: string; url?: string }[] };
  const item = d.data?.[0];
  if (item?.b64_json) return { bytes: fromBase64(item.b64_json), mime: 'image/png' };
  if (item?.url) {
    // Lien temporaire (DALL·E) : téléchargé sans la clé.
    const r = await aiFetch({ url: item.url, binary: true });
    return { bytes: fromBase64(r.body), mime: 'image/png' };
  }
  throw new Error('no-image');
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
