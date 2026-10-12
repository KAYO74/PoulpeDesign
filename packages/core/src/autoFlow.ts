import { createText } from './factory';
import { flowText, framePart, textChain } from './flow';
import { arrangePages, documentPages, insertPage, moveArtboard } from './pages';
import type { MeasureText } from './text';
import { findNode } from './tree';
import type { PoulpeDocument, TextNode } from './types';

export interface AutoFlowOptions {
  /** Nom de la n-ième page du document (à partir de 1). */
  pageName: (n: number) => string;
  /** Nom des nouveaux cadres. */
  frameName?: string;
  /** Range les pages après coup (Persona Mise en page) ; sinon chaque page se pose sous la précédente. */
  arrange?: boolean;
  /** Nombre maximal de pages ajoutées. */
  maxPages?: number;
}

/**
 * Coulée automatique (Maj+clic sur l'indicateur de débordement), comme dans Affinity Publisher :
 * après la page du dernier cadre, ajoute des pages (avec la même page maître) qui portent chacune
 * un cadre de même taille au même endroit, lié au précédent, jusqu'à ce que tout le texte tienne.
 * Modifie le document ; renvoie les ids des cadres ajoutés (aucun si rien ne déborde).
 */
export function autoFlowText(
  doc: PoulpeDocument,
  id: string,
  measure: MeasureText,
  opts: AutoFlowOptions,
): string[] {
  const chain = textChain(doc, id);
  const head = chain[0];
  if (!head) return [];
  const flow = flowText(doc, id, measure, null);
  if (!flow.overflow) return [];
  let tail = chain[chain.length - 1];
  const page = findNode(doc, tail.id)?.artboard;
  if (!page || page.master) return [];
  const text = flow.text;
  let offset = flow.parts[flow.parts.length - 1]?.end ?? 0;
  const rel = { x: tail.x - page.x, y: tail.y - page.y };
  const gap = Math.max(40, Math.round(Math.max(page.width, page.height) * 0.08));
  const made: string[] = [];
  let after = page;
  const max = opts.maxPages ?? 500;
  while (made.length < max && offset < text.length && text.slice(offset).trim()) {
    const ab = insertPage(doc, {
      afterId: after.id,
      name: opts.pageName(documentPages(doc).length + 1),
      width: page.width,
      height: page.height,
    });
    if (!opts.arrange) moveArtboard(ab, after.x, after.y + after.height + gap);
    const frame = createText({
      x: ab.x + rel.x,
      y: ab.y + rel.y,
      width: tail.width,
      height: tail.height,
      name: opts.frameName ?? tail.name,
      autoWidth: false,
    });
    frame.frame = true;
    frame.rotation = tail.rotation;
    // Le nouveau cadre reprend les réglages du précédent (couleur, marges, forme, habillage).
    frame.fill = tail.fill;
    frame.stroke = tail.stroke;
    if (tail.insets) frame.insets = [...tail.insets];
    if (tail.frameShape) frame.frameShape = tail.frameShape;
    if (tail.ignoreWrap) frame.ignoreWrap = true;
    if (tail.hideOverflow) frame.hideOverflow = true;
    ab.children.push(frame);
    const prev = findNode(doc, tail.id)!.node as TextNode;
    prev.frame = true;
    prev.next = frame.id;
    const part = framePart(doc, frame, head, text, offset, measure);
    if (part.end <= offset) {
      // Rien ne tient dans un cadre de cette taille (police trop grande) : on n'insiste pas.
      doc.artboards.splice(doc.artboards.indexOf(ab), 1);
      delete prev.next;
      break;
    }
    made.push(frame.id);
    offset = part.end;
    after = ab;
    tail = frame;
  }
  if (made.length && opts.arrange) arrangePages(doc);
  return made;
}
