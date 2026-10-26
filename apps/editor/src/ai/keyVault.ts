/*
 * Clés API en mode navigateur : chiffrées (AES-GCM) avant d'être gardées. La clé de chiffrement est
 * non exportable et reste dans IndexedDB ; le stockage local ne contient plus aucune clé lisible.
 */

const DB = 'poulpe-vault';
const STORE = 'keys';
const MASTER = 'master';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let master: Promise<CryptoKey> | null = null;

function masterKey(): Promise<CryptoKey> {
  master ??= (async () => {
    const db = await openDb();
    const found = await request<CryptoKey | undefined>(db, 'readonly', (s) => s.get(MASTER));
    if (found) return found;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await request(db, 'readwrite', (s) => s.put(key, MASTER));
    return key;
  })();
  return master;
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await masterKey(),
    new TextEncoder().encode(text),
  );
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(data))}`;
}

/** Texte d'origine, ou `null` si la valeur est illisible (clé de chiffrement perdue). */
export async function unseal(sealed: string): Promise<string | null> {
  const [v, iv, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) },
      await masterKey(),
      fromB64(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Une valeur déjà chiffrée par `seal` ? Sinon c'est une ancienne clé en clair à chiffrer. */
export const isSealed = (value: string) => /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value);
