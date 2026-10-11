import {
  createDocument,
  createEllipse,
  createRect,
  createStar,
  createText,
  defaultStyle,
  findNode,
  translateNode,
  type SceneNode,
} from '@poulpe/core';
import { getController } from './components/Viewport';
import { editor, ui } from './store';

/*
 * Mesure des performances, pour comparer le navigateur et l'appli de bureau (WebKitGTK sous
 * Linux en particulier) et pour suivre l'effet des optimisations. Lancement : `?bench` dans
 * l'URL de l'éditeur, ou `POULPE_BENCH=1` pour l'appli de bureau, qui écrit le rapport sur la
 * sortie standard.
 *
 * Chaque scénario rejoue un geste réel (survol, déplacement, zoom…) image par image. Le temps
 * d'une image compte tout le travail qu'elle provoque : le geste lui-même, la mise à jour des
 * panneaux (React), les dessins demandés pour l'image suivante (canevas, règles) et la fin du
 * dessin par le navigateur.
 */

export interface BenchResult {
  scenario: string;
  frames: number;
  avgMs: number;
  p95Ms: number;
  fps: number;
}

export interface BenchReport {
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  objects: number;
  results: BenchResult[];
  /** Mémoire JavaScript occupée à la fin, en Mo (Chromium seulement). */
  heapMb?: number;
  /** Isolation multi-origine (threads de calcul partagés) disponible. */
  isolated: boolean;
}

const FRAMES = 60;

function stats(scenario: string, times: number[]): BenchResult {
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { scenario, frames: times.length, avgMs: r(avg), p95Ms: r(p95), fps: Math.round(1000 / avg) };
}

type Mix = 'all' | 'solid' | 'gradient' | 'text';

/**
 * Document d'essai : `count` objets variés (dégradés, contours, rotations) dont un texte sur 25.
 * `mix` ne garde qu'une famille d'objets, pour savoir ce qui coûte.
 */
export function benchDocument(count: number, mix: Mix = 'all') {
  const doc = createDocument({ name: 'Mesure', width: 1920, height: 1080 });
  const ab = doc.artboards[0];
  const style = defaultStyle();
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    const box = { x: rand() * 1800, y: rand() * 1000, width: 30 + rand() * 120, height: 30 + rand() * 120 };
    let n: SceneNode;
    if (i % 25 === 0) {
      n = createText(
        { ...box, width: 260, text: 'Festival des Mers, du 12 au 14 juillet', autoWidth: false },
        style,
      );
    } else if (i % 3 === 0) n = createEllipse(box, style);
    else if (i % 3 === 1) n = createStar(box, style, 5, 0.5);
    else n = createRect(box, style);
    if ('fill' in n && n.type !== 'text')
      n.fill =
        i % 4 === 0
          ? {
              type: 'linear',
              angle: rand() * 360,
              stops: [
                { offset: 0, color: '#ff5c8a' },
                { offset: 1, color: '#4da3ff' },
              ],
            }
          : {
              type: 'solid',
              color: `#${Math.floor(rand() * 0xffffff)
                .toString(16)
                .padStart(6, '0')}`,
            };
    const keep =
      mix === 'all' ||
      (mix === 'text' && n.type === 'text') ||
      (mix === 'gradient' && n.type !== 'text' && n.fill.type === 'linear') ||
      (mix === 'solid' && n.type !== 'text' && n.fill.type === 'solid');
    if (!keep) continue;
    if ('stroke' in n) n.stroke = { paint: { type: 'solid', color: '#1a1a1d' }, width: 2 };
    n.rotation = i % 5 === 0 ? rand() * 90 : 0;
    ab.children.push(n);
  }
  return doc;
}

/*
 * Chronométrage des images demandées par `requestAnimationFrame` : on enveloppe la fonction
 * pour additionner la durée des rappels exécutés pendant la mesure.
 */
let rafWork = 0;
let rafPatched = false;
function patchRaf() {
  if (rafPatched) return;
  rafPatched = true;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const t0 = performance.now();
      try {
        cb(t);
      } finally {
        rafWork += performance.now() - t0;
      }
    });
}

const microtasks = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

/** `only` : ne lancer que les scénarios dont le nom contient ce texte. */
export async function runBenchmark(count = 1000, only?: string): Promise<BenchReport> {
  const c = getController();
  if (!c) throw new Error('canevas absent');
  patchRaf();
  const ctx = c.canvas.getContext('2d')!;
  const results: BenchResult[] = [];
  const invalidate = () => (c as unknown as { invalidate?: () => void }).invalidate?.();
  // Laisse passer l'image en cours, puis vide les caches de rendu (premier affichage).
  const settle = async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 50));
  };

  const measure = async (scenario: string, step: (i: number) => void) => {
    if (only && !scenario.includes(only)) return;
    await settle();
    const times: number[] = [];
    for (let i = 0; i < FRAMES + 5; i++) {
      rafWork = 0;
      const t0 = performance.now();
      step(i);
      await microtasks();
      const sync = performance.now() - t0;
      // Image suivante : les dessins demandés par le geste, puis la fin du dessin.
      const flush = await new Promise<number>((r) =>
        requestAnimationFrame(() => {
          const f0 = performance.now();
          // Lire un pixel force le navigateur à finir le dessin : on mesure le rendu réel.
          ctx.getImageData(0, 0, 1, 1);
          r(performance.now() - f0);
        }),
      );
      // `rafWork` compte aussi notre propre rappel, donc la fin du dessin (`flush`).
      void flush;
      const dt = sync + rafWork;
      if (i >= 5) times.push(dt);
    }
    results.push(stats(scenario, times));
  };

  const load = async (mix: Mix = 'all') => {
    editor.load(benchDocument(count, mix));
    c.zoomToFit();
    await settle();
  };

  for (const [mix, label] of [
    ['solid', 'formes unies seules'],
    ['gradient', 'formes en dégradé seules'],
    ['text', 'blocs de texte seuls'],
  ] as const) {
    await load(mix);
    await measure(`premier affichage, ${label} (${editor.doc.artboards[0].children.length})`, () => {
      invalidate();
      c.requestDraw();
    });
  }
  await load();
  await measure('premier affichage, document complet', () => {
    invalidate();
    c.requestDraw();
  });

  // Survol : la souris passe sur les objets, sans rien modifier.
  const rect = c.canvas.getBoundingClientRect();
  await measure('survol à la souris', (i) => {
    const x = rect.left + 40 + ((i * 37) % Math.max(1, rect.width - 80));
    const y = rect.top + 40 + ((i * 23) % Math.max(1, rect.height - 80));
    c.canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }),
    );
  });

  const kids = editor.doc.artboards[0].children;
  const ids = kids.slice(0, 50).map((n) => n.id);
  editor.select(ids);
  await settle();
  editor.begin();
  await measure('déplacement de 50 objets', (i) =>
    editor.preview((d) => {
      for (const id of ids) translateNode(findNode(d, id)!.node, i, i / 2);
    }),
  );
  editor.cancel();

  const shape = kids.find((n) => n.type === 'rect')!;
  editor.select([shape.id]);
  await settle();
  editor.begin();
  await measure("réglage de la couleur d'un objet", (i) =>
    editor.preview((d) => {
      const n = findNode(d, shape.id)!.node;
      if (n.type === 'rect') n.fill = { type: 'solid', color: `#${(0x203040 + i * 0x010203).toString(16)}` };
    }),
  );
  editor.cancel();
  editor.select([]);

  const v0 = ui.get().view;
  await measure('défilement', (i) => {
    ui.set({ view: { ...v0, panX: v0.panX + i * 3, panY: v0.panY - i * 2 } });
  });
  await measure('zoom', (i) => {
    const z = v0.zoom * (1 + 0.5 * Math.sin(i / 10));
    ui.set({ view: { zoom: z, panX: v0.panX, panY: v0.panY } });
  });
  // Même zoom, redessiné net à chaque image (qualité d'aperçu « complète »).
  const perf = await import('./perf');
  const quality = perf.getPerformanceSettings().previewQuality;
  perf.setPerformanceSettings({ previewQuality: 'full' });
  await measure('zoom, net à chaque image', (i) => {
    const z = v0.zoom * (1 + 0.5 * Math.sin(i / 10));
    ui.set({ view: { zoom: z, panX: v0.panX, panY: v0.panY } });
  });
  perf.setPerformanceSettings({ previewQuality: quality });
  // Zoom × 4 au centre : la plupart des objets sont hors de la fenêtre.
  const z4 = {
    zoom: v0.zoom * 4,
    panX: c.width / 2 - (c.width / 2 - v0.panX) * 4,
    panY: c.height / 2 - (c.height / 2 - v0.panY) * 4,
  };
  await measure('défilement, zoom × 4', (i) => {
    ui.set({ view: { ...z4, panX: z4.panX - i * 4, panY: z4.panY - i * 2 } });
  });
  ui.set({ view: v0 });

  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    userAgent: navigator.userAgent,
    viewport: { width: c.width, height: c.height, dpr: window.devicePixelRatio || 1 },
    objects: count,
    results,
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined,
    isolated: self.crossOriginIsolated,
  };
}

/** Lance la mesure si elle est demandée (paramètre `?bench` ou appli de bureau en mode mesure). */
export async function maybeRunBenchmark(desktop: boolean): Promise<void> {
  let wanted = new URLSearchParams(location.search).has('bench');
  let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
  if (desktop) {
    invoke = (await import('@tauri-apps/api/core')).invoke;
    wanted = Boolean(await invoke('bench_mode').catch(() => false));
  }
  if (!wanted) return;
  await new Promise((r) => setTimeout(r, 1000));
  const report = await runBenchmark();
  (window as unknown as { poulpeBench: BenchReport }).poulpeBench = report;
  console.log(JSON.stringify(report));
  if (invoke) await invoke('bench_report', { report: JSON.stringify(report, null, 2) });
}
