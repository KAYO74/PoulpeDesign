import {
  caretAt,
  chainHead,
  charX,
  findNode,
  frameShapeCommands,
  isLinked,
  localToWorld,
  needsFlow,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  pageFields as pageFieldsOf,
} from '@poulpe/core';
import { cachedFlow, measureText, toPath2D } from '@poulpe/render';
import { ui } from '../store';
import type { CanvasController } from './controller';
import { textSelection } from './textEdit';
import { editParts, partAt } from './textParts';

/*
 * Texte sur le canevas : sélection et curseur du texte en cours d'édition, cadres de texte (contour,
 * liens entre les cadres d'une chaîne) et indicateur de débordement, que le pointeur peut viser.
 */

/** Sélection et curseur du texte en cours d'édition, dans chaque cadre de sa chaîne. */
export function drawTextSelection(ctl: CanvasController, doc: PoulpeDocument, id: string) {
  const head = findNode(doc, id)?.node;
  const sel = textSelection();
  if (head?.type !== 'text' || !sel || head.path) return;
  const ctx = ctl.ctx;
  const v = ctl.view;
  const parts = editParts(doc, id);
  const caretPart = sel.start === sel.end ? partAt(parts, sel.start) : null;
  for (const { node: n, layout } of parts) {
    if (caretPart && caretPart.node !== n) continue;
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
    ctx.rotate((n.rotation * Math.PI) / 180);
    ctx.translate(-n.width / 2, -n.height / 2);
    if (caretPart) {
      const c = caretAt(layout, sel.start, measureText);
      ctx.fillStyle = ctl.colors.sel;
      ctx.fillRect(c.x - 0.75 / v.zoom, c.top, 1.5 / v.zoom, c.height);
    } else {
      ctx.fillStyle = 'rgba(77,163,255,0.35)';
      for (const line of layout.lines) {
        const a = Math.max(sel.start, line.start);
        const b = Math.min(sel.end, line.stop);
        if (b < a || (b === a && !(line.start === line.stop && sel.start <= a && a < sel.end))) continue;
        const x0 = charX(line, a, measureText);
        // Une fin de ligne sélectionnée (retour à la ligne compris) se voit par un petit débord.
        const x1 = charX(line, b, measureText) + (sel.end > line.end ? line.size * 0.25 : 0);
        ctx.fillRect(x0, line.top, Math.max(x1 - x0, 1 / v.zoom), line.height);
      }
    }
    ctx.restore();
  }
}

/** Cadres de texte : contour pointillé, liens entre cadres de la sélection et indicateur de débordement. */
export function drawFrames(ctl: CanvasController, doc: PoulpeDocument, selection: string[]) {
  const ctx = ctl.ctx;
  const v = ctl.view;
  const sel = new Set(selection);
  const linkFrom = ui.get().linkFrom;
  ctl.overflowMarks = [];
  for (const { node: n } of walkTexts(doc)) {
    if (!isFrameText(doc, n) || !n.visible) continue;
    const head = chainHead(doc, n.id);
    const chain = head ? editPartsChain(doc, head.id) : null;
    const inSel = !!chain?.nodes.some((c) => sel.has(c.id));
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
    ctx.rotate((n.rotation * Math.PI) / 180);
    ctx.translate(-n.width / 2, -n.height / 2);
    ctx.lineWidth = 1 / v.zoom;
    ctx.setLineDash([3 / v.zoom, 3 / v.zoom]);
    ctx.strokeStyle = inSel ? ctl.colors.sel : 'rgba(120,120,130,0.55)';
    // Cadre de forme : son contour.
    if (n.frameShape) ctx.stroke(toPath2D(frameShapeCommands(n)));
    else ctx.strokeRect(0, 0, n.width, n.height);
    ctx.restore();
    // Débordement : petit carré rouge « + » en bas à droite du dernier cadre (sauf texte en trop masqué).
    const last = chain?.nodes[chain.nodes.length - 1];
    const overflow = last?.id === n.id && chain!.overflow && !n.hideOverflow;
    if (overflow || linkFrom === n.id || (inSel && last?.id === n.id)) {
      const q = ctl.toScreen(localToWorld(n, { x: n.width, y: n.height }));
      const s = 12;
      ctx.save();
      ctx.fillStyle = overflow ? '#e5484d' : ctl.colors.sel;
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(q.x - 3.5, q.y);
      ctx.lineTo(q.x + 3.5, q.y);
      ctx.moveTo(q.x, q.y - 3.5);
      ctx.lineTo(q.x, q.y + 3.5);
      ctx.stroke();
      ctx.restore();
      ctl.overflowMarks.push({ id: n.id, x: q.x, y: q.y });
    }
  }
  // Liens entre les cadres de la chaîne sélectionnée.
  for (const id of selection) {
    const n = findNode(doc, id)?.node;
    if (n?.type !== 'text' || !isLinked(doc, id)) continue;
    const head = chainHead(doc, id)!;
    const nodes = editPartsChain(doc, head.id).nodes;
    ctx.save();
    ctx.strokeStyle = ctl.colors.sel;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = ctl.toScreen(localToWorld(nodes[k], { x: nodes[k].width, y: nodes[k].height }));
      const b = ctl.toScreen(localToWorld(nodes[k + 1], { x: 0, y: 0 }));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
    break;
  }
}

/** Indicateur de débordement (ou de lien) sous le pointeur. */
export function hitOverflow(ctl: CanvasController, sx: number, sy: number): string | null {
  for (const m of ctl.overflowMarks) if (Math.abs(m.x - sx) <= 8 && Math.abs(m.y - sy) <= 8) return m.id;
  return null;
}

/** Cadre de texte (hauteur fixe) ou cadre d'une chaîne de cadres liés. */
export function isFrameText(doc: PoulpeDocument, n: SceneNode): boolean {
  return n.type === 'text' && !n.path && (!!n.frame || !!n.next || isLinked(doc, n.id));
}

function* walkTexts(doc: PoulpeDocument): Generator<{ node: TextNode }> {
  const visit = function* (nodes: SceneNode[]): Generator<{ node: TextNode }> {
    for (const n of nodes) {
      if (n.type === 'group') yield* visit(n.children);
      else if (n.type === 'text') yield { node: n };
    }
  };
  for (const ab of doc.artboards) yield* visit(ab.children);
}

/** Cadres d'une chaîne et débordement, d'après la répartition du texte. */
function editPartsChain(doc: PoulpeDocument, headId: string): { nodes: TextNode[]; overflow: boolean } {
  const head = findNode(doc, headId)?.node;
  if (head?.type !== 'text' || !needsFlow(doc, head)) return { nodes: [], overflow: false };
  const page = findNode(doc, headId)!.artboard;
  const flow = cachedFlow(doc, headId, ui.get().editingTextId === headId ? null : pageFieldsOf(doc, page));
  return { nodes: flow.parts.map((p) => p.node), overflow: flow.overflow };
}
