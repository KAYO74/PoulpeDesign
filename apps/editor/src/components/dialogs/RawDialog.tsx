import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { P, ParamField } from '../../panels/AdjustmentPanel';
import {
  applyLocals,
  LOCAL_PARAMS,
  newLocalAdjust,
  type LocalAdjust,
  type LocalParam,
} from '../../photo/localAdjust';
import {
  closeRaw,
  copyDevelopSettings,
  DEFAULT_DEVELOP,
  developRaw,
  pastedDevelopSettings,
  rawPhoto,
  type DevelopSettings,
} from '../../photo/rawDevelop';
import { Modal } from './Modal';

const PARAMS = [
  P('exposure', -5, 5, 'IL', 0.05),
  P('temperature', -100, 100),
  P('tint', -100, 100),
  P('contrast', -100, 100),
  P('highlights', -100, 100),
  P('shadows', -100, 100),
  P('vibrance', -100, 100),
  P('saturation', -100, 100),
];

const LOCAL_FIELDS: Record<LocalParam, ReturnType<typeof P>> = {
  exposure: P('exposure', -5, 5, 'IL', 0.05),
  contrast: P('contrast', -100, 100),
  saturation: P('saturation', -100, 100),
  temperature: P('temperature', -100, 100),
};

/** Fenêtre de développement d'une photo RAW : aperçu réduit, réglages, retouches locales, puis Développer. */
export function RawDialog() {
  const t = useT();
  const photo = rawPhoto();
  const [s, setS] = useState<DevelopSettings>(DEFAULT_DEVELOP);
  const [canPaste, setCanPaste] = useState(() => pastedDevelopSettings() !== null);
  const [locals, setLocals] = useState<LocalAdjust[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 4, h: 3 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const current = locals.find((l) => l.id === active) ?? null;
  const patch = (id: string, p: Partial<LocalAdjust>) =>
    setLocals((list) => list.map((l) => (l.id === id ? { ...l, ...p } : l)));

  useEffect(() => {
    if (!photo) return;
    const id = requestAnimationFrame(() => {
      const img = applyLocals(photo.render(s, 900), locals);
      const c = canvas.current;
      if (!c) return;
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
      setSize((old) => (old.w === img.width && old.h === img.height ? old : { w: img.width, h: img.height }));
    });
    return () => cancelAnimationFrame(id);
  }, [photo, s, locals]);

  /** Glisser sur l'aperçu place le masque du réglage local choisi. */
  const drag = (e: React.PointerEvent) => {
    if (!current) return;
    const box = frame.current!.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => ({
      x: Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
    });
    const a = at(e);
    const id = current.id;
    patch(id, { x1: a.x, y1: a.y, x2: a.x, y2: a.y });
    const move = (ev: PointerEvent) => {
      const b = at(ev);
      patch(id, { x2: b.x, y2: b.y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const add = (kind: LocalAdjust['kind']) => {
    const l = newLocalAdjust(kind);
    setLocals((list) => [...list, l]);
    setActive(l.id);
  };

  if (!photo) return null;
  return (
    <Modal title={t('raw.title')} onClose={closeRaw} xl>
      <div className="raw-develop">
        <div className="raw-stage">
          <div
            className="raw-frame"
            ref={frame}
            style={{ aspectRatio: `${size.w} / ${size.h}` }}
            onPointerDown={drag}
            data-testid="raw-frame"
          >
            <canvas ref={canvas} className="raw-preview" data-testid="raw-preview" />
            {current && (
              <svg className="raw-mask" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                {current.kind === 'linear' ? (
                  <>
                    <line x1={current.x1} y1={current.y1} x2={current.x2} y2={current.y2} />
                    <circle cx={current.x1} cy={current.y1} r="0.012" />
                    <circle cx={current.x2} cy={current.y2} r="0.012" />
                  </>
                ) : (
                  <ellipse
                    cx={current.x1}
                    cy={current.y1}
                    rx={
                      Math.hypot((current.x2 - current.x1) * size.w, (current.y2 - current.y1) * size.h) /
                      size.w
                    }
                    ry={
                      Math.hypot((current.x2 - current.x1) * size.w, (current.y2 - current.y1) * size.h) /
                      size.h
                    }
                  />
                )}
              </svg>
            )}
          </div>
        </div>
        <div className="raw-params">
          <p className="note">
            {photo.width} × {photo.height} px
          </p>
          {PARAMS.map((p) => (
            <ParamField
              key={p.key}
              p={p}
              value={s[p.key as keyof DevelopSettings]}
              onChange={(v) => setS((old) => ({ ...old, [p.key]: v }))}
            />
          ))}
          <button className="btn small" onClick={() => setS(DEFAULT_DEVELOP)}>
            {t('param.reset')}
          </button>
          <div className="raw-copy">
            <button
              className="btn small"
              title={t('raw.copyHint')}
              data-testid="raw-copy"
              onClick={() => {
                copyDevelopSettings(s);
                setCanPaste(true);
              }}
            >
              {t('raw.copy')}
            </button>
            <button
              className="btn small"
              disabled={!canPaste}
              title={t('raw.pasteHint')}
              data-testid="raw-paste"
              onClick={() => {
                const p = pastedDevelopSettings();
                if (p) setS(p);
              }}
            >
              {t('raw.paste')}
            </button>
          </div>

          <h3 className="raw-sub">{t('raw.local')}</h3>
          <div className="raw-copy">
            <button className="btn small" data-testid="raw-add-linear" onClick={() => add('linear')}>
              {t('raw.localLinear')}
            </button>
            <button className="btn small" data-testid="raw-add-radial" onClick={() => add('radial')}>
              {t('raw.localRadial')}
            </button>
          </div>
          {locals.length > 0 && (
            <div className="raw-locals" role="listbox" aria-label={t('raw.local')}>
              {locals.map((l, i) => (
                <button
                  key={l.id}
                  role="option"
                  aria-selected={l.id === active}
                  className="chip-btn"
                  aria-pressed={l.id === active}
                  onClick={() => setActive(l.id)}
                >
                  {t(l.kind === 'linear' ? 'raw.localLinear' : 'raw.localRadial')} {i + 1}
                </button>
              ))}
            </div>
          )}
          {current && (
            <>
              <p className="note">{t('raw.localHint')}</p>
              {LOCAL_PARAMS.map((k) => (
                <ParamField
                  key={k}
                  p={LOCAL_FIELDS[k]}
                  value={current[k]}
                  onChange={(v) => patch(current.id, { [k]: v })}
                />
              ))}
              {current.kind === 'radial' && (
                <>
                  <ParamField
                    p={P('feather', 0, 100, undefined, undefined, 'raw.localFeather')}
                    value={current.feather}
                    onChange={(v) => patch(current.id, { feather: v })}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={current.invert}
                      onChange={(e) => patch(current.id, { invert: e.target.checked })}
                    />
                    {t('raw.localInvert')}
                  </label>
                </>
              )}
              <button
                className="btn small"
                data-testid="raw-local-delete"
                onClick={() => {
                  setLocals((list) => list.filter((l) => l.id !== current.id));
                  setActive(null);
                }}
              >
                {t('raw.localDelete')}
              </button>
            </>
          )}
        </div>
      </div>
      <footer>
        <span className="spacer" />
        <button className="btn" onClick={closeRaw}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="raw-develop" onClick={() => developRaw(s, locals)}>
          {t('raw.develop')}
        </button>
      </footer>
    </Modal>
  );
}
