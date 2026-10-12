import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { caretAt, charX, cssFont, findNode, type TextLine, type TextNode } from '@poulpe/core';
import { measureText } from '@poulpe/render';
import { editParts, indexAtWorld, partAt } from '../canvas/textParts';
import { CanvasController } from '../canvas/controller';
import {
  currentEditedText,
  endTextEdit,
  keepEditingOnBlur,
  registerTextInput,
  resetTypingStyle,
  setEditedText,
  setTextSelection,
} from '../canvas/textEdit';
import { placeImageBytes } from '../io';
import { placeSvg } from '../vectorActions';
import { addElement, type ElementKind } from '../libraryActions';
import { ELEMENT_MIME } from '../panels/Library';
import { editor, ui, useEditor, useUi } from '../store';
import { CanvasMenu } from './CanvasMenu';
import { textEditKey } from '../tools/text/keys';

let controller: CanvasController | null = null;
export const getController = () => controller;

const RULER = 18;

export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerX = useRef<HTMLCanvasElement>(null);
  const rulerY = useRef<HTMLCanvasElement>(null);
  const rulers = useUi((s) => s.settings.rulers);

  useLayoutEffect(() => {
    const host = hostRef.current!;
    const c = new CanvasController(canvasRef.current!, host);
    controller = c;
    const area = canvasRef.current!.parentElement!;
    let fitted = false;
    const ro = new ResizeObserver(() => {
      const r = area.getBoundingClientRect();
      c.resize(r.width, r.height);
      if (!fitted && r.width > 0) {
        fitted = true;
        c.zoomToFit();
      }
      drawRulers();
    });
    ro.observe(area);
    // Les règles ne changent qu'avec la vue (ou le thème), et une fois par image au plus.
    let frame = 0;
    const drawRulers = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (rulerX.current && rulerY.current) paintRulers(rulerX.current, rulerY.current, c);
    };
    let last = ui.get();
    const unsub = ui.subscribe(() => {
      const s = ui.get();
      if (s.view === last.view && s.settings.theme === last.settings.theme) return;
      last = s;
      frame ||= requestAnimationFrame(drawRulers);
    });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      unsub();
      c.dispose();
      controller = null;
    };
  }, []);

  useEffect(() => {
    if (controller && rulerX.current && rulerY.current)
      paintRulers(rulerX.current, rulerY.current, controller);
  }, [rulers]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const element = e.dataTransfer.getData(ELEMENT_MIME);
    if (element && controller) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const { kind, id } = JSON.parse(element) as { kind: ElementKind; id: string };
      addElement(kind, id, controller.toWorld(e.clientX - rect.left, e.clientY - rect.top));
      return;
    }
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!file || !controller) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const at = controller.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (file.type === 'image/svg+xml' && placeSvg(await file.text(), file.name.replace(/\.svg$/i, ''), at))
      return;
    await placeImageBytes(new Uint8Array(await file.arrayBuffer()), file.type, at);
  };

  return (
    <div
      ref={hostRef}
      className={`viewport${rulers ? ' with-rulers' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {rulers && (
        <>
          <div className="ruler-corner" />
          <canvas
            ref={rulerX}
            className="ruler ruler-x"
            aria-hidden="true"
            data-testid="ruler-x"
            onPointerDown={(e) => e.button === 0 && controller?.dragGuide('y', null, e.nativeEvent)}
          />
          <canvas
            ref={rulerY}
            className="ruler ruler-y"
            aria-hidden="true"
            data-testid="ruler-y"
            onPointerDown={(e) => e.button === 0 && controller?.dragGuide('x', null, e.nativeEvent)}
          />
        </>
      )}
      <div className="canvas-area">
        <canvas ref={canvasRef} className="main-canvas" data-testid="canvas" tabIndex={-1} />
        <TextEditor />
      </div>
      <CanvasMenu />
    </div>
  );
}

function paintRulers(cx: HTMLCanvasElement, cy: HTMLCanvasElement, c: CanvasController) {
  const dpr = window.devicePixelRatio || 1;
  const cs = getComputedStyle(cx);
  const bg = cs.getPropertyValue('--ruler').trim() || '#26262b';
  const tick = cs.getPropertyValue('--tick').trim() || '#6e6c78';
  const { zoom, panX, panY } = ui.get().view;
  // Pas des graduations : au moins 60 px d'écran entre deux étiquettes.
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const step = steps.find((s) => s * zoom >= 60) ?? 10000;
  const draw = (canvas: HTMLCanvasElement, length: number, pan: number, vertical: boolean) => {
    const w = Math.round((vertical ? RULER : length) * dpr);
    const h = Math.round((vertical ? length : RULER) * dpr);
    // Changer la taille d'une toile la réalloue : seulement quand la fenêtre change de taille.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${vertical ? RULER : length}px`;
      canvas.style.height = `${vertical ? length : RULER}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vertical ? RULER : length, vertical ? length : RULER);
    ctx.strokeStyle = tick;
    ctx.fillStyle = tick;
    ctx.font = '9px "Inter", system-ui, sans-serif';
    ctx.lineWidth = 1;
    const start = Math.floor(-pan / zoom / step) * step;
    const end = (length - pan) / zoom;
    ctx.beginPath();
    for (let v = start; v <= end; v += step / 5) {
      const s = Math.round(v * zoom + pan) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const h = major ? RULER : 5;
      if (vertical) {
        ctx.moveTo(RULER - h, s);
        ctx.lineTo(RULER, s);
      } else {
        ctx.moveTo(s, RULER - h);
        ctx.lineTo(s, RULER);
      }
      if (major) {
        const label = String(Math.round(v));
        if (vertical) {
          ctx.save();
          ctx.translate(9, s + 3);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        } else ctx.fillText(label, s + 3, 9);
      }
    }
    ctx.stroke();
  };
  draw(cx, c.width, panX, false);
  draw(cy, c.height, panY, true);
}

const notify = () => window.dispatchEvent(new Event('poulpe:textselection'));

/** Point écran (relatif au canevas) vers indice du texte édité. */
function indexFromEvent(e: { clientX: number; clientY: number }, node: TextNode): number {
  const c = controller!;
  const rect = c.canvas.getBoundingClientRect();
  const p = c.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  return indexAtWorld(editParts(editor.doc, node.id), p, true) ?? 0;
}

/** Indice le plus proche de l'abscisse `x` sur une ligne. */
function indexOnLine(
  line: ReturnType<typeof editParts>[number]['layout']['lines'][number],
  x: number,
): number {
  let best = line.start;
  let bestD = Infinity;
  for (let i = line.start; i <= line.end; i++) {
    const d = Math.abs(charX(line, i, measureText) - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function wordAt(text: string, i: number): [number, number] {
  let a = i,
    b = i;
  while (a > 0 && /[\p{L}\p{N}_]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}_]/u.test(text[b])) b++;
  return a === b ? [i, Math.min(text.length, i + 1)] : [a, b];
}

/**
 * Zone de saisie invisible posée sur le texte en cours d'édition. Elle reçoit le clavier
 * (y compris les méthodes de saisie) ; le texte, le curseur et la sélection sont dessinés par le canevas.
 */
function TextEditor() {
  const editingId = useUi((s) => s.editingTextId);
  // Sans texte en édition, rien à suivre : pas de mise à jour à chaque changement du document.
  return editingId ? <EditingText editingId={editingId} /> : null;
}

function EditingText({ editingId }: { editingId: string }) {
  const state = useEditor();
  useUi((s) => s.view);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const anchor = useRef(0);
  const [initial, setInitial] = useState('');

  useEffect(() => {
    if (!editingId) return;
    setInitial(currentEditedText());
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.select();
      notify();
    });
  }, [editingId]);

  if (!controller) return null;
  const node = findNode(state.doc, editingId)?.node as TextNode | undefined;
  const fallback = ui.get().defaults;
  const style = node?.style ?? fallback.text;
  const frame = node
    ? controller.screenFrame(node)
    : { x: 0, y: 0, width: 10, height: style.fontSize, rotation: 0, zoom: ui.get().view.zoom };
  const z = frame.zoom;

  const moveVertically = (el: HTMLTextAreaElement, dir: -1 | 1, extend: boolean) => {
    if (!node) return;
    // Les lignes de tous les cadres d'une chaîne se suivent : on passe d'un cadre au suivant.
    const parts = editParts(state.doc, node.id);
    const focus = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
    const part = partAt(parts, focus);
    const c = caretAt(part.layout, focus, measureText);
    const lines = parts.flatMap((p) => p.layout.lines);
    const cur = part.layout.lines[c.line];
    // Cadre habillé : plusieurs lignes partagent une hauteur ; on va à la bande du dessus ou du
    // dessous dans la même colonne, sur la ligne la plus proche du curseur.
    const band = part.layout.lines.filter(
      (l) =>
        (l.column ?? 0) === (cur.column ?? 0) && (dir > 0 ? l.top > cur.top + 0.5 : l.top < cur.top - 0.5),
    );
    const near = band.length && cur.slot ? nearestInBand(band, dir, c.x) : null;
    const target = near ?? lines[lines.indexOf(cur) + dir];
    const i = target ? indexOnLine(target, c.x) : dir < 0 ? 0 : node.text.length;
    const a = extend ? (el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart) : i;
    setTextSelection(a, i);
  };

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        registerTextInput(el);
      }}
      className="text-editor"
      data-testid="text-editor"
      defaultValue={initial}
      key={editingId + initial}
      spellCheck={false}
      wrap={node?.autoWidth ? 'off' : 'soft'}
      style={{
        left: frame.x,
        top: frame.y,
        width: Math.max(frame.width + 4 * z, 8),
        height: Math.max(frame.height, style.fontSize * style.lineHeight * z),
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
        fontFamily: cssFont(style).replace(/^.*?px /, ''),
        fontSize: style.fontSize * z,
        fontWeight: style.fontWeight,
        fontStyle: style.italic ? 'italic' : 'normal',
        lineHeight: style.lineHeight,
        textAlign: style.align,
        whiteSpace: node?.autoWidth ? 'pre' : 'pre-wrap',
      }}
      onChange={(e) => {
        setEditedText(e.target.value);
        notify();
      }}
      onSelect={notify}
      onBlur={(e) => {
        if (!keepEditingOnBlur(e.relatedTarget)) endTextEdit();
      }}
      onPointerDown={(e) => {
        if (!node || e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const i = indexFromEvent(e, node);
        if (e.detail === 2) {
          const [a, b] = wordAt(node.text, i);
          anchor.current = a;
          setTextSelection(a, b);
          return;
        }
        if (e.detail >= 3) {
          setTextSelection(0, node.text.length);
          return;
        }
        if (!e.shiftKey) anchor.current = i;
        setTextSelection(anchor.current, i);
        el.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!node || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setTextSelection(anchor.current, indexFromEvent(e, node));
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Gras, italique, taille, alignement, interlettrage : appliqués à la sélection dans le texte.
        if (textEditKey(e.nativeEvent)) {
          e.preventDefault();
          return;
        }
        const el = e.currentTarget;
        if (e.key === 'Escape') {
          e.preventDefault();
          el.blur();
          endTextEdit();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          moveVertically(el, e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
          return;
        }
        if ((e.key === 'Home' || e.key === 'End') && node && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const focus = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
          const { layout } = partAt(editParts(state.doc, node.id), focus);
          const line = layout.lines[caretAt(layout, focus, measureText).line];
          const i = e.key === 'Home' ? line.start : line.end;
          const a = e.shiftKey
            ? el.selectionDirection === 'backward'
              ? el.selectionEnd
              : el.selectionStart
            : i;
          setTextSelection(a, i);
          return;
        }
        if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown') resetTypingStyle();
      }}
      onKeyUp={notify}
    />
  );
}

/** Ligne de la bande voisine (la plus haute en descendant, la plus basse en montant) la plus proche de `x`. */
function nearestInBand(lines: TextLine[], dir: -1 | 1, x: number): TextLine {
  const top = dir > 0 ? Math.min(...lines.map((l) => l.top)) : Math.max(...lines.map((l) => l.top));
  const row = lines.filter((l) => Math.abs(l.top - top) < 0.5);
  const dist = (l: TextLine) => {
    const [a, b] = l.slot ?? [l.offset, l.offset + l.width];
    return Math.max(0, a - x, x - b);
  };
  return row.reduce((best, l) => (dist(l) < dist(best) ? l : best));
}
