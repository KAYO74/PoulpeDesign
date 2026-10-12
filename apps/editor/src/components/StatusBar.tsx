import { findArtboard } from '@poulpe/core';
import { boundsOf } from '../actions';
import { useT } from '../i18n';
import { useEffect, useState } from 'react';
import { formatMb } from '../diagnostics';
import { usedMemoryMb } from '../preferences';
import { useEditor, useUi } from '../store';

const HINTS: Record<string, string> = {
  select: 'hint.select',
  direct: 'hint.direct',
  artboard: 'hint.artboard',
  rect: 'hint.shape',
  ellipse: 'hint.shape',
  polygon: 'hint.shape',
  star: 'hint.shape',
  line: 'hint.line',
  text: 'hint.text',
  image: 'hint.image',
  hand: 'hint.hand',
  zoom: 'hint.zoom',
  eyedropper: 'hint.eyedropper',
  pen: 'hint.pen',
  pencil: 'hint.pencil',
  // Outil Recadrage de la Persona Photo (« hint.crop » est le recadrage d'une image).
  crop: 'hint.cropTool',
};

/**
 * Images par seconde et mémoire (Préférences > Affichage) : compte les images dessinées par le
 * navigateur pendant une seconde. Ne tourne que si l'option est cochée.
 */
function PerfMeter() {
  const [stats, setStats] = useState<{ fps: number; mem: number | null }>({ fps: 0, mem: null });
  useEffect(() => {
    let frames = 0;
    let start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - start >= 1000) {
        setStats({ fps: Math.round((frames * 1000) / (now - start)), mem: usedMemoryMb() });
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="num perf-meter" data-testid="perf-meter">
      {stats.fps} i/s{stats.mem !== null && ` · ${formatMb(stats.mem)}`}
    </span>
  );
}

export function StatusBar() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const zoom = useUi((s) => s.view.zoom);
  const cursor = useUi((s) => s.cursor);
  const toastMsg = useUi((s) => s.toast);
  const cropping = useUi((s) => s.cropId !== null);
  const busy = useUi((s) => s.busy);
  const perfMeter = useUi((s) => s.settings.perfMeter);
  const { doc, selection, activeArtboardId } = useEditor();
  const ab = findArtboard(doc, activeArtboardId);
  const b = selection.length ? boundsOf(doc, selection) : null;
  return (
    <footer className="statusbar">
      <span className="hint">
        <b>{cropping ? t('ctx.crop') : t(`tool.${tool}`)}</b> :{' '}
        {t(cropping ? 'hint.crop' : (HINTS[tool] ?? `hint.${tool}`))}
      </span>
      <span className="spacer" />
      {busy && (
        <span className="busy" role="status" data-testid="busy">
          {busy.label}
          <span className="progress">
            <span style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </span>
        </span>
      )}
      {toastMsg && (
        <span className="toast" role="status">
          {toastMsg}
        </span>
      )}
      <span className="num">
        {b ? `${Math.round(b.width)} × ${Math.round(b.height)} px` : t('status.nothing')}
      </span>
      <span className="num">{cursor ? `x ${cursor.x} · y ${cursor.y}` : 'x – · y –'}</span>
      {ab && <span className="num">{`${ab.width} × ${ab.height} px`}</span>}
      {perfMeter && <PerfMeter />}
      <span className="num" data-testid="zoom">
        {Math.round(zoom * 100)} %
      </span>
    </footer>
  );
}
