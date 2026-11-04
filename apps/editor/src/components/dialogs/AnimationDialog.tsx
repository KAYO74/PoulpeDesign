import {
  ANIMATION_KINDS,
  animateArtboard,
  animationLength,
  defaultAnimation,
  encodeGif,
  findArtboard,
  findNode,
  topLevelIds,
  validAnimation,
  type AnimationKind,
  type Artboard,
  type GifFrame,
  type PoulpeDocument,
} from '@poulpe/core';
import { ImageCache, drawArtboard } from '@poulpe/render';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { saveBytes } from '../../io';
import { editor, useEditor } from '../../store';
import { NumberField, Select } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/*
 * Animation simple (comme les animations d'entrée de Canva) : une entrée par objet (fondu, montée,
 * glissement, zoom, rebond, tourbillon), avec durée et délai, un aperçu qui tourne en boucle et
 * l'export du plan de travail en GIF animé.
 */

const images = new ImageCache();
/** Images par seconde de l'export ; le GIF compte en centièmes de seconde. */
const FPS = 15;
/** Temps de pause sur l'image finale, avant que le GIF reprenne (secondes). */
const HOLD = 1.5;
const SIZES = [480, 800, 1080] as const;

function activeArtboard(doc: PoulpeDocument): Artboard | null {
  return findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0] ?? null;
}

/** Plan de travail au temps t, dessiné dans `ctx` à l'échelle `k`. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  doc: PoulpeDocument,
  ab: Artboard,
  t: number,
  k: number,
): void {
  const frame = animateArtboard(ab, t);
  const at = { ...doc, artboards: doc.artboards.map((a) => (a.id === ab.id ? frame : a)) };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(k, k);
  ctx.translate(-ab.x, -ab.y);
  drawArtboard(ctx, at, frame, { images });
}

/** GIF animé du plan de travail, `size` pixels sur le plus grand côté. */
async function artboardGif(doc: PoulpeDocument, ab: Artboard, size: number): Promise<Uint8Array> {
  await images.ready(doc);
  const k = Math.min(1, size / Math.max(ab.width, ab.height));
  const w = Math.max(1, Math.round(ab.width * k)),
    h = Math.max(1, Math.round(ab.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const length = animationLength(ab);
  const count = Math.max(1, Math.ceil(length * FPS));
  const frames: GifFrame[] = [];
  for (let i = 0; i <= count; i++) {
    drawFrame(ctx, doc, ab, i / FPS, k);
    frames.push({
      data: ctx.getImageData(0, 0, w, h).data,
      delay: i === count ? 100 * HOLD : 100 / FPS,
    });
    // Laisse respirer l'interface entre deux images.
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
  }
  return encodeGif(frames, w, h);
}

export function AnimationDialog() {
  const t = useT();
  const { doc, selection } = useEditor();
  const ids = topLevelIds(doc, selection);
  const ab = activeArtboard(doc);
  const first = ids.length ? findNode(doc, ids[0])?.node : null;
  const current = first ? validAnimation(first.animation) : null;
  const length = ab ? animationLength(ab) : 0;
  const [size, setSize] = useState<number>(480);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(0);
  const preview = useRef<HTMLCanvasElement>(null);

  // Aperçu en boucle : l'animation, puis une pause sur l'image finale.
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas || !ab) return;
    const k = Math.min(360 / ab.width, 240 / ab.height);
    canvas.width = Math.max(1, Math.round(ab.width * k));
    canvas.height = Math.max(1, Math.round(ab.height * k));
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const start = performance.now();
    void images.ready(doc).then(() => {
      const tick = (now: number) => {
        const cycle = length + HOLD;
        const time = length ? ((now - start) / 1000) % cycle : length;
        drawFrame(ctx, doc, ab, time, k);
        canvas.dataset.time = time.toFixed(2);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, ab, length, replay]);

  const set = (patch: Partial<{ kind: AnimationKind | 'none'; duration: number; delay: number }>) => {
    editor.apply('history.animation', (d) => {
      for (const id of ids) {
        const n = findNode(d, id)?.node;
        if (!n) continue;
        const kind = patch.kind ?? validAnimation(n.animation)?.kind ?? 'fade';
        if (kind === 'none') {
          delete n.animation;
          continue;
        }
        const base = validAnimation(n.animation) ?? defaultAnimation(kind);
        n.animation = validAnimation({ ...base, ...patch, kind }) ?? base;
      }
    });
    setReplay((r) => r + 1);
  };

  const exportGif = async () => {
    if (!ab) return;
    setBusy(true);
    setStatus(t('anim.exporting'));
    try {
      const bytes = await artboardGif(doc, ab, size);
      const name = await saveBytes(bytes, 'gif', ab.name || doc.name);
      setStatus(name ? t('anim.saved', { name }) : '');
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('anim.title')} onClose={close}>
      {ids.length ? (
        <div className="picker-row" data-testid="anim-object">
          <Select
            label={t('anim.kind')}
            value={current?.kind ?? 'none'}
            testId="anim-kind"
            options={(['none', ...ANIMATION_KINDS] as const).map((k) => ({
              value: k,
              label: t(`anim.kind.${k}`),
            }))}
            onChange={(kind) => set({ kind })}
          />
          <NumberField
            label={t('anim.duration')}
            value={current?.duration ?? null}
            min={0.05}
            max={60}
            decimals={2}
            unit="s"
            width={80}
            testId="anim-duration"
            disabled={!current}
            onChange={(duration) => set({ duration })}
          />
          <NumberField
            label={t('anim.delay')}
            value={current?.delay ?? null}
            min={0}
            max={60}
            decimals={2}
            unit="s"
            width={80}
            testId="anim-delay"
            disabled={!current}
            onChange={(delay) => set({ delay })}
          />
        </div>
      ) : (
        <p className="hint">{t('anim.noSelection')}</p>
      )}
      <canvas ref={preview} className="anim-preview" data-testid="anim-preview" />
      {!length && <p className="note">{t('anim.empty')}</p>}
      <div className="picker-row">
        <Select
          label={t('anim.size')}
          value={size}
          testId="anim-size"
          options={SIZES.map((s) => ({ value: s, label: `${s} px` }))}
          onChange={setSize}
        />
        <button
          className="btn"
          data-testid="anim-play"
          disabled={!length}
          onClick={() => setReplay((r) => r + 1)}
        >
          {t('anim.play')}
        </button>
      </div>
      {status && (
        <p className="note" data-testid="anim-status">
          {status}
        </p>
      )}
      <footer>
        <button className="btn" onClick={close}>
          {t('common.close')}
        </button>
        <button
          className="btn primary"
          data-testid="anim-export"
          disabled={!length || busy}
          onClick={() => void exportGif()}
        >
          {t('anim.export')}
        </button>
      </footer>
    </Modal>
  );
}
