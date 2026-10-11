import { useEffect, useRef, useState } from 'react';
import {
  documentMasters,
  documentPages,
  masterOf,
  pageNumber,
  type Artboard,
  type PoulpeDocument,
} from '@poulpe/core';
import { ImageCache, drawArtboard } from '@poulpe/render';
import { Icon } from '../components/Icon';
import { Select } from '../components/fields';
import { useT } from '../i18n';
import { addMaster, addPage, applyMaster, arrange, canDeletePage, reorderPage } from '../layoutActions';
import { ui, useEditor, useStore } from '../store';
import { AddPagesDialog, ApplyMasterDialog } from '../tools/frames/PageDialogs';
import {
  chosenPages,
  clickPage,
  deletePages,
  detachPages,
  duplicatePages,
} from '../tools/frames/pageActions';
import { framesState } from '../tools/frames/state';

/*
 * Panneau Pages de la Persona Mise en page, comme celui d'Affinity Publisher : les pages maîtres
 * en haut, les pages en dessous (en doubles pages si le document est en vis-à-vis). Un clic
 * affiche la page, un glisser la déplace, et une page maître glissée sur une page s'y applique.
 */

const images = new ImageCache(() => window.dispatchEvent(new Event('poulpe:thumbs')));
const PAGE_MIME = 'application/x-poulpe-page';
const MASTER_MIME = 'application/x-poulpe-master';

/** Miniature d'une page, redessinée (avec un léger délai) quand la page ou sa page maître change. */
function PageThumb({ doc, ab, size }: { doc: PoulpeDocument; ab: Artboard; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const master = masterOf(doc, ab);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('poulpe:thumbs', bump);
    return () => window.removeEventListener('poulpe:thumbs', bump);
  }, []);
  const k = Math.min(size / ab.width, size / ab.height);
  const w = Math.max(1, Math.round(ab.width * k)),
    h = Math.max(1, Math.round(ab.height * k));
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(k * dpr, k * dpr);
      ctx.translate(-ab.x, -ab.y);
      drawArtboard(ctx, doc, ab, { images });
    }, 120);
    return () => clearTimeout(timer);
    // Le document change à chaque modification : seuls la page et sa page maître comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ab, master, w, h, tick]);
  return <canvas ref={ref} className="page-canvas" style={{ width: w, height: h }} aria-hidden="true" />;
}

function PageCard({
  doc,
  ab,
  index,
  active,
  label,
  chosen,
}: {
  doc: PoulpeDocument;
  ab: Artboard;
  index: number;
  active: boolean;
  label: string;
  /** Choisie avec d'autres (Maj ou Ctrl + clic). */
  chosen?: boolean;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  const master = masterOf(doc, ab);
  return (
    <button
      className={`page-card${active || chosen ? ' on' : ''}${over ? ' drop' : ''}`}
      data-testid={ab.master ? `master-${index}` : `page-${index}`}
      aria-pressed={active || chosen}
      title={ab.name}
      draggable
      onClick={(e) => clickPage(ab.id, e)}
      onDragStart={(e) => {
        e.dataTransfer.setData(ab.master ? MASTER_MIME : PAGE_MIME, ab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (ab.master) return;
        const types = e.dataTransfer.types;
        if (types.includes(PAGE_MIME) || types.includes(MASTER_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const pageId = e.dataTransfer.getData(PAGE_MIME);
        const masterId = e.dataTransfer.getData(MASTER_MIME);
        if (masterId) applyMaster(masterId, [ab.id]);
        else if (pageId && pageId !== ab.id) reorderPage(pageId, index);
      }}
    >
      <span className="page-thumb">
        <span className="page-paper">
          <PageThumb doc={doc} ab={ab} size={ab.master ? 64 : 84} />
          {master && (
            <span className="page-badge" title={t('pages.usesMaster', { name: master.name })}>
              {master.name.charAt(0)}
            </span>
          )}
        </span>
      </span>
      <span className="page-label">{label}</span>
    </button>
  );
}

export function PagesPanel() {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  // Pages choisies ensemble (Maj ou Ctrl + clic) : supprimées, dupliquées ou détachées ensemble.
  useStore(framesState, (s) => s.pages);
  const chosen = chosenPages(doc);
  const [dialog, setDialog] = useState<'add' | 'master' | null>(null);
  const linked = chosen.some((id) => {
    const a = doc.artboards.find((p) => p.id === id);
    return !!a && !!masterOf(doc, a);
  });
  const pages = documentPages(doc);
  const masters = documentMasters(doc);
  const active = doc.artboards.find((a) => a.id === activeArtboardId);
  const facing = !!doc.layout?.facing;
  // En vis-à-vis : la page 1 seule à droite, puis des doubles pages.
  const rows: (Artboard | null)[][] = [];
  if (facing) {
    rows.push([null, pages[0]]);
    for (let i = 1; i < pages.length; i += 2) rows.push([pages[i], pages[i + 1] ?? null]);
  }
  const card = (ab: Artboard, i: number) => (
    <PageCard
      key={ab.id}
      doc={doc}
      ab={ab}
      index={i}
      active={ab.id === activeArtboardId}
      chosen={chosen.length > 1 && chosen.includes(ab.id)}
      label={String(pageNumber(doc, ab) ?? i + 1)}
    />
  );
  return (
    <aside className="library pages-panel" aria-label={t('pages.title')} data-testid="pages-panel">
      <header className="studio-tabs" role="tablist">
        <span className="studio-tab" role="tab" aria-selected="true">
          {t('pages.title')}
        </span>
        <span className="spacer" />
        <button
          className="ib small"
          title={t('cmd.documentSetup')}
          aria-label={t('cmd.documentSetup')}
          onClick={() => ui.set({ dialog: 'document' })}
        >
          <Icon name="settings" size={14} />
        </button>
      </header>
      <div className="studio-content pages-scroll">
        <div className="pages-head">
          <h4 className="sub">{t('pages.masters')}</h4>
          <button
            className="ib small"
            title={t('pages.addMaster')}
            aria-label={t('pages.addMaster')}
            data-testid="add-master"
            onClick={addMaster}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {masters.length ? (
          <div className="pages-grid masters">
            {masters.map((m, i) => (
              <PageCard
                key={m.id}
                doc={doc}
                ab={m}
                index={i}
                active={m.id === activeArtboardId}
                label={m.name}
              />
            ))}
          </div>
        ) : (
          <p className="note small">{t('pages.noMaster')}</p>
        )}
        <div className="pages-head">
          <h4 className="sub">{t('pages.pages', { n: pages.length })}</h4>
        </div>
        {facing ? (
          <div className="pages-spreads">
            {rows.map((row, r) => (
              <div key={r} className="spread">
                {row.map((ab, k) =>
                  ab ? card(ab, pages.indexOf(ab)) : <span key={`e${k}`} className="page-card empty" />,
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="pages-grid">{pages.map(card)}</div>
        )}
      </div>
      <footer className="pages-foot">
        {active && !active.master && (
          <Select
            label={t('pages.master')}
            value={active.masterId && masters.some((m) => m.id === active.masterId) ? active.masterId : ''}
            options={[
              { value: '', label: t('pages.none') },
              ...masters.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => applyMaster(v || null, [active.id])}
          />
        )}
        <div className="pages-actions">
          <button
            className="ib"
            title={t('pages.add')}
            aria-label={t('pages.add')}
            data-testid="add-page"
            onClick={addPage}
          >
            <Icon name="plus" />
          </button>
          <button
            className="ib"
            title={t('frames.addPages')}
            aria-label={t('frames.addPages')}
            data-testid="add-pages"
            onClick={() => setDialog('add')}
          >
            <Icon name="pages" />
          </button>
          <button
            className="ib"
            title={t(chosen.length > 1 ? 'frames.duplicatePages' : 'pages.duplicate')}
            aria-label={t(chosen.length > 1 ? 'frames.duplicatePages' : 'pages.duplicate')}
            data-testid="duplicate-page"
            onClick={() => duplicatePages(chosen)}
          >
            <Icon name="duplicate" />
          </button>
          <button
            className="ib"
            title={t(chosen.length > 1 ? 'frames.deletePages' : 'pages.delete')}
            aria-label={t(chosen.length > 1 ? 'frames.deletePages' : 'pages.delete')}
            data-testid="delete-page"
            disabled={chosen.length > 1 ? false : !canDeletePage()}
            onClick={() => deletePages(chosen)}
          >
            <Icon name="trash" />
          </button>
          <button
            className="ib"
            title={t('frames.applyMaster')}
            aria-label={t('frames.applyMaster')}
            data-testid="apply-master"
            disabled={!masters.length}
            onClick={() => setDialog('master')}
          >
            <Icon name="master" />
          </button>
          <button
            className="ib"
            title={`${t('frames.detachMaster')} — ${t('frames.detachHint')}`}
            aria-label={t('frames.detachMaster')}
            data-testid="detach-master"
            disabled={!linked}
            onClick={() => detachPages(chosen)}
          >
            <Icon name="unlink" />
          </button>
          <span className="spacer" />
          <button className="ib" title={t('pages.arrange')} aria-label={t('pages.arrange')} onClick={arrange}>
            <Icon name="arrange" />
          </button>
        </div>
        {chosen.length > 1 && <p className="note small">{t('frames.chosen', { n: chosen.length })}</p>}
      </footer>
      {dialog === 'add' && <AddPagesDialog onClose={() => setDialog(null)} />}
      {dialog === 'master' && <ApplyMasterDialog onClose={() => setDialog(null)} />}
    </aside>
  );
}
