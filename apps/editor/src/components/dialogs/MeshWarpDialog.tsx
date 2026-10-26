import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { closeMeshWarp, drawWarped, meshSource, regularMesh, type Mesh } from '../../photo/meshWarp';
import { Select } from '../fields';
import { Modal } from './Modal';

const SIZES = [2, 3, 4, 6, 8];

/** Déformation en maillage : on tire les points de la grille sur l'aperçu, puis Appliquer. */
export function MeshWarpDialog() {
  const t = useT();
  const src = meshSource();
  const [n, setN] = useState(4);
  const [mesh, setMesh] = useState<Mesh>(() => regularMesh(4));
  const [drag, setDrag] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Aperçu : au plus 640 px de côté.
  const k = src ? Math.min(1, 640 / Math.max(src.width, src.height)) : 1;
  const w = src ? Math.round(src.width * k) : 1,
    h = src ? Math.round(src.height * k) : 1;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !src) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    drawWarped(ctx, src, n, mesh, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    const at = (i: number, j: number) => mesh[j * (n + 1) + i];
    ctx.beginPath();
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const p = at(i, j);
        if (i < n) {
          ctx.moveTo(p.x * w, p.y * h);
          ctx.lineTo(at(i + 1, j).x * w, at(i + 1, j).y * h);
        }
        if (j < n) {
          ctx.moveTo(p.x * w, p.y * h);
          ctx.lineTo(at(i, j + 1).x * w, at(i, j + 1).y * h);
        }
      }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const p of mesh) ctx.fillRect(p.x * w - 3, p.y * h - 3, 6, 6);
  }, [src, n, mesh, w, h]);
  if (!src) return null;
  const local = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  return (
    <Modal title={t('warp.title')} onClose={() => closeMeshWarp()} xl>
      <p className="note">{t('warp.hint')}</p>
      <div className="picker-row">
        <Select<string>
          label={t('warp.grid')}
          value={String(n)}
          options={SIZES.map((s) => ({ value: String(s), label: `${s} × ${s}` }))}
          onChange={(v) => {
            setN(Number(v));
            setMesh(regularMesh(Number(v)));
          }}
        />
        <button className="btn small" onClick={() => setMesh(regularMesh(n))}>
          {t('param.reset')}
        </button>
      </div>
      <div className="warp-stage">
        <canvas
          ref={canvas}
          width={w}
          height={h}
          className="warp-canvas"
          data-testid="warp-canvas"
          onPointerDown={(e) => {
            const p = local(e);
            let best = -1,
              dist = Infinity;
            mesh.forEach((q, i) => {
              const d = Math.hypot((q.x - p.x) * w, (q.y - p.y) * h);
              if (d < dist) [best, dist] = [i, d];
            });
            if (dist > 14) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(best);
          }}
          onPointerMove={(e) => {
            if (drag === null) return;
            const p = local(e);
            setMesh((m) => m.map((q, i) => (i === drag ? p : q)));
          }}
          onPointerUp={() => setDrag(null)}
        />
      </div>
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={() => closeMeshWarp()}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="warp-apply" onClick={() => closeMeshWarp({ n, mesh })}>
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
