/*
 * Projet enregistré en PSD (version 1.2.10) : le fichier est un vrai PSD à calques, que Photoshop
 * et Affinity ouvrent, et il porte en plus le document Poulpe Design complet (tracés, textes,
 * effets…) dans une ressource réservée aux modules (identifiants 4000 à 4999, que les autres
 * logiciels ignorent). Poulpe Design le rouvre tel quel ; un PSD réenregistré ailleurs perd cette
 * ressource et s'ouvre alors par ses calques.
 */

/** Identifiant de la ressource (plage des modules externes de Photoshop). */
const RESOURCE_ID = 4021;
const MAGIC = 'POULPEDS';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be32 = (v: DataView, at: number) => v.getUint32(at);

/** Début et longueur de la section « ressources d'image » d'un PSD. */
function resourcesSection(psd: Uint8Array): { lenAt: number; start: number; end: number } | null {
  if (psd.length < 34 || String.fromCharCode(...psd.subarray(0, 4)) !== '8BPS') return null;
  const v = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  const colorLen = be32(v, 26);
  const lenAt = 30 + colorLen;
  if (lenAt + 4 > psd.length) return null;
  const start = lenAt + 4;
  const end = start + be32(v, lenAt);
  return end <= psd.length ? { lenAt, start, end } : null;
}

/** Ajoute le document Poulpe Design (fichier `.poulpe`) dans un PSD. */
export function embedPoulpe(psd: Uint8Array, poulpe: Uint8Array): Uint8Array {
  const sec = resourcesSection(psd);
  if (!sec) throw new Error('psd: invalid');
  const data = new Uint8Array(MAGIC.length + poulpe.length);
  data.set(ascii(MAGIC), 0);
  data.set(poulpe, MAGIC.length);
  const pad = data.length % 2;
  // « 8BIM », identifiant, nom vide (2 octets), taille, données (longueur paire).
  const block = new Uint8Array(4 + 2 + 2 + 4 + data.length + pad);
  const b = new DataView(block.buffer);
  block.set(ascii('8BIM'), 0);
  b.setUint16(4, RESOURCE_ID);
  b.setUint32(8, data.length);
  block.set(data, 12);
  const out = new Uint8Array(psd.length + block.length);
  out.set(psd.subarray(0, sec.end), 0);
  out.set(block, sec.end);
  out.set(psd.subarray(sec.end), sec.end + block.length);
  new DataView(out.buffer).setUint32(sec.lenAt, sec.end - sec.start + block.length);
  return out;
}

/** Document Poulpe Design porté par un PSD, ou null (PSD ordinaire). */
export function extractPoulpe(psd: Uint8Array): Uint8Array | null {
  const sec = resourcesSection(psd);
  if (!sec) return null;
  const v = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  let p = sec.start;
  while (p + 12 <= sec.end) {
    if (String.fromCharCode(...psd.subarray(p, p + 4)) !== '8BIM') return null;
    const id = v.getUint16(p + 4);
    const nameLen = psd[p + 6];
    const nameSize = (1 + nameLen + 1) & ~1;
    const sizeAt = p + 6 + nameSize;
    if (sizeAt + 4 > sec.end) return null;
    const size = be32(v, sizeAt);
    const dataAt = sizeAt + 4;
    if (dataAt + size > sec.end) return null;
    if (id === RESOURCE_ID && size > MAGIC.length) {
      const head = String.fromCharCode(...psd.subarray(dataAt, dataAt + MAGIC.length));
      if (head === MAGIC) return psd.slice(dataAt + MAGIC.length, dataAt + size);
    }
    p = dataAt + size + (size % 2);
  }
  return null;
}
