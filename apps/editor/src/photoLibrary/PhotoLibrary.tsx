import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Select } from '../components/fields';
import { hasFiles } from '../dropFiles';
import { t as tr, useT } from '../i18n';
import { makeRoomForDocument } from '../docTabs';
import { openBytes, openPhotoBytes } from '../io';
import { toast, ui } from '../store';
import { formatExposure } from './exif';
import {
  DEFAULT_FILTER,
  LABELS,
  PHOTO_ACCEPT,
  cleanKeyword,
  filterPhotos,
  groups,
  canLinkFolder,
  importPhotos,
  linkFolder,
  isRaw,
  loadLibrary,
  mimeOf,
  photoFile,
  removePhotos,
  updatePhotos,
  useLibrary,
  type Label,
  type LibraryFilter,
  type LibraryPhoto,
} from './catalog';

/*
 * Vue Bibliothèque photo : à gauche les dossiers et mots-clés, au centre la planche de
 * vignettes avec ses filtres, à droite la fiche de la photo choisie (note, drapeau, couleur,
 * mots-clés, infos de prise de vue). Raccourcis de Lightroom : 0-5, P, X, U, 6-9.
 */

const PREFS_KEY = 'poulpe.photoLibrary';

function loadPrefs(): { size: number; sort: LibraryFilter['sort'] } {
  try {
    return { size: 160, sort: 'date', ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { size: 160, sort: 'date' };
  }
}

const LABEL_KEYS: Record<string, Label> = { '6': 'red', '7': 'yellow', '8': 'green', '9': 'blue' };

export const closePhotoLibrary = () => ui.set({ photoLibrary: false });

/** Ouvre une photo : un RAW passe par la fenêtre de développement, une image va en Persona Photo. */
export async function openLibraryPhoto(p: LibraryPhoto): Promise<void> {
  const blob = await photoFile(p.id);
  if (!blob) {
    toast(tr('plib.missing'));
    return;
  }
  makeRoomForDocument();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  closePhotoLibrary();
  if (isRaw(p.name)) await openBytes(p.name, bytes);
  else await openPhotoBytes(bytes, mimeOf(p.name), p.name.replace(/\.[^.]+$/, ''));
}

export function PhotoLibrary() {
  const t = useT();
  const photos = useLibrary((s) => s.photos);
  const importing = useLibrary((s) => s.importing);
  const prefs = useMemo(loadPrefs, []);
  const [filter, setFilter] = useState<LibraryFilter>({ ...DEFAULT_FILTER, sort: prefs.sort });
  const [size, setSize] = useState(prefs.size);
  const [sel, setSel] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadLibrary();
    root.current?.focus();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ size, sort: filter.sort }));
    } catch {
      /* stockage indisponible : réglage gardé pour la session */
    }
  }, [size, filter.sort]);

  const shown = useMemo(() => filterPhotos(photos, filter), [photos, filter]);
  const { folders, keywords } = useMemo(() => groups(photos), [photos]);
  const selected = shown.filter((p) => sel.includes(p.id));
  const current = selected.length ? selected[selected.length - 1] : null;
  const patch = (f: Partial<LibraryFilter>) => setFilter((s) => ({ ...s, ...f }));

  const runImport = async (
    files: File[] | null | Promise<{ added: LibraryPhoto[]; failed: number } | null>,
  ) => {
    const r = Array.isArray(files) ? (files.length ? await importPhotos(files) : null) : await files;
    if (!r) return;
    const { added, failed } = r;
    if (added.length) toast(t('plib.imported', { n: added.length }));
    if (failed) toast(t('plib.importFailed', { n: failed }));
    if (added.length) setSel([added[added.length - 1].id]);
  };

  const click = (e: React.MouseEvent, p: LibraryPhoto) => {
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((q) => q.id === anchor);
      const b = shown.findIndex((q) => q.id === p.id);
      const range = shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((q) => q.id);
      setSel(range);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => (s.includes(p.id) ? s.filter((id) => id !== p.id) : [...s, p.id]));
    } else setSel([p.id]);
    setAnchor(p.id);
  };

  const remove = () => {
    if (!selected.length) return;
    if (!window.confirm(t('plib.removeConfirm', { n: selected.length }))) return;
    void removePhotos(selected.map((p) => p.id));
    setSel([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [role="menu"], [role="dialog"]')) return;
    const ids = selected.map((p) => p.id);
    const k = e.key;
    let used = true;
    if (k === 'Escape') closePhotoLibrary();
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') setSel(shown.map((p) => p.id));
    else if (e.ctrlKey || e.metaKey || e.altKey) used = false;
    else if (/^[0-5]$/.test(k)) updatePhotos(ids, () => ({ rating: +k }));
    else if (k in LABEL_KEYS)
      updatePhotos(ids, (p) => ({ label: p.label === LABEL_KEYS[k] ? null : LABEL_KEYS[k] }));
    else if (k.toLowerCase() === 'p') updatePhotos(ids, () => ({ flag: 'pick' }));
    else if (k.toLowerCase() === 'x') updatePhotos(ids, () => ({ flag: 'reject' }));
    else if (k.toLowerCase() === 'u') updatePhotos(ids, () => ({ flag: null }));
    else if (k === 'Enter' && current) void openLibraryPhoto(current);
    else if (k === 'Delete' || k === 'Backspace') remove();
    else if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown' || k === 'ArrowUp') {
      if (!shown.length) return;
      const grid = root.current?.querySelector('.plib-grid') as HTMLElement | null;
      const perRow = grid ? Math.max(1, Math.floor(grid.clientWidth / (size + 12))) : 1;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }[k];
      const i = current ? shown.findIndex((p) => p.id === current.id) : -1;
      const next = shown[Math.max(0, Math.min(shown.length - 1, i + step))];
      setSel([next.id]);
      setAnchor(next.id);
      root.current?.querySelector(`[data-photo="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      className={`plib${drag ? ' drop' : ''}`}
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={t('plib.title')}
      data-testid="photo-library"
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        void runImport([...e.dataTransfer.files]);
      }}
    >
      <nav className="plib-side" aria-label={t('plib.folders')}>
        <button
          className="plib-item"
          aria-pressed={filter.folder === null && filter.keyword === null}
          onClick={() => patch({ folder: null, keyword: null })}
        >
          <Icon name="photoLibrary" />
          <span>{t('plib.all')}</span>
          <span className="num">{photos.length}</span>
        </button>
        {folders.length > 0 && <span className="plib-head">{t('plib.folders')}</span>}
        {folders.map(([f, n]) => (
          <button
            key={`f:${f}`}
            className="plib-item"
            aria-pressed={filter.folder === f}
            onClick={() => patch({ folder: f, keyword: null })}
            title={f || t('plib.loose')}
          >
            <Icon name="folder" />
            <span>{f ? f.split('/').pop() : t('plib.loose')}</span>
            <span className="num">{n}</span>
          </button>
        ))}
        {keywords.length > 0 && <span className="plib-head">{t('plib.keywords')}</span>}
        {keywords.map(([k, n]) => (
          <button
            key={`k:${k}`}
            className="plib-item"
            aria-pressed={filter.keyword === k}
            onClick={() => patch({ keyword: filter.keyword === k ? null : k })}
          >
            <span className="plib-hash">#</span>
            <span>{k}</span>
            <span className="num">{n}</span>
          </button>
        ))}
      </nav>

      <section className="plib-main">
        <div className="plib-bar">
          <button
            className="btn primary"
            onClick={() => filesInput.current?.click()}
            data-testid="plib-import"
          >
            <Icon name="import" />
            {t('plib.import')}
          </button>
          <button
            className="btn"
            onClick={() => (canLinkFolder() ? void runImport(linkFolder()) : folderInput.current?.click())}
            title={canLinkFolder() ? t('plib.openFolderHint') : undefined}
            data-testid="plib-open-folder"
          >
            <Icon name="folder" />
            {canLinkFolder() ? t('plib.openFolder') : t('plib.importFolder')}
          </button>
          <input
            ref={filesInput}
            type="file"
            multiple
            accept={PHOTO_ACCEPT}
            hidden
            data-testid="plib-files"
            onChange={(e) => {
              void runImport([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(e) => {
              void runImport([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <input
            className="text-input plib-search"
            type="search"
            placeholder={t('plib.search')}
            aria-label={t('plib.search')}
            value={filter.text}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <span className="spacer" />
          <button className="btn" onClick={closePhotoLibrary} data-testid="plib-close">
            {t('plib.close')}
          </button>
        </div>
        <div className="plib-bar filters">
          <Select
            label={t('plib.minRating')}
            testId="plib-min-rating"
            value={filter.minRating}
            onChange={(v) => patch({ minRating: v })}
            options={[0, 1, 2, 3, 4, 5].map((n) => ({
              value: n,
              label: n ? t('plib.stars', { n }) : t('plib.anyRating'),
            }))}
          />
          <Select
            label={t('plib.flagFilter')}
            testId="plib-flag"
            value={filter.flag}
            onChange={(v) => patch({ flag: v })}
            options={[
              { value: 'all', label: t('plib.flagAll') },
              { value: 'pick', label: t('plib.flagPick') },
              { value: 'none', label: t('plib.flagNone') },
              { value: 'reject', label: t('plib.flagReject') },
            ]}
          />
          <div className="plib-labels" role="group" aria-label={t('plib.labelFilter')}>
            <button
              className="plib-label all"
              aria-pressed={filter.label === 'all'}
              title={t('plib.labelAll')}
              aria-label={t('plib.labelAll')}
              onClick={() => patch({ label: 'all' })}
            />
            {LABELS.map((l) => (
              <button
                key={l}
                className={`plib-label ${l}`}
                aria-pressed={filter.label === l}
                title={t(`plib.label.${l}`)}
                aria-label={t(`plib.label.${l}`)}
                onClick={() => patch({ label: filter.label === l ? 'all' : l })}
              />
            ))}
          </div>
          <Select
            label={t('plib.sort')}
            testId="plib-sort"
            value={filter.sort}
            onChange={(v) => patch({ sort: v })}
            options={[
              { value: 'date', label: t('plib.sortDate') },
              { value: 'added', label: t('plib.sortAdded') },
              { value: 'name', label: t('plib.sortName') },
              { value: 'rating', label: t('plib.sortRating') },
            ]}
          />
          <span className="spacer" />
          <label className="plib-size">
            <input
              type="range"
              min={96}
              max={320}
              step={8}
              value={size}
              aria-label={t('plib.size')}
              onChange={(e) => setSize(+e.target.value)}
            />
          </label>
        </div>

        {importing && (
          <div className="plib-progress" role="status">
            {t('plib.importing', importing)}
            <span style={{ width: `${(importing.done / Math.max(1, importing.total)) * 100}%` }} />
          </div>
        )}

        {shown.length ? (
          <div
            className="plib-grid"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t('plib.title')}
            onClick={(e) => e.target === e.currentTarget && setSel([])}
          >
            {shown.map((p) => (
              <div
                key={p.id}
                className={`plib-card${p.flag === 'reject' ? ' rejected' : ''}`}
                role="option"
                aria-selected={sel.includes(p.id)}
                aria-label={p.name}
                data-photo={p.id}
                onClick={(e) => click(e, p)}
                onDoubleClick={() => void openLibraryPhoto(p)}
              >
                <div className="plib-thumb" style={{ height: size * 0.75 }}>
                  <img src={p.thumb} alt="" draggable={false} />
                  {p.flag && (
                    <span className={`plib-flag ${p.flag}`}>
                      <Icon name={p.flag === 'pick' ? 'flag' : 'flagReject'} size={14} />
                    </span>
                  )}
                  {isRaw(p.name) && <span className="plib-raw">RAW</span>}
                </div>
                <div className="plib-meta">
                  {p.label && <span className={`plib-dot ${p.label}`} />}
                  <span className="plib-name">{p.name}</span>
                  {p.rating > 0 && <span className="plib-stars">{'★'.repeat(p.rating)}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="plib-empty">
            <Icon name="photoLibrary" size={40} />
            <p>{photos.length ? t('plib.noMatch') : t('plib.empty')}</p>
            {!photos.length && <p className="muted">{t('plib.emptyHint')}</p>}
          </div>
        )}
        <div className="plib-foot">
          <span>{t('plib.count', { n: shown.length })}</span>
          {selected.length > 1 && <span>{t('plib.selected', { n: selected.length })}</span>}
          <span className="spacer" />
          <span className="muted">{t('plib.shortcuts')}</span>
        </div>
      </section>

      <aside className="plib-info" aria-label={t('plib.info')}>
        {current ? <PhotoInfo photo={current} ids={selected.map((p) => p.id)} onRemove={remove} /> : null}
      </aside>
    </div>
  );
}

function PhotoInfo({
  photo: p,
  ids,
  onRemove,
}: {
  photo: LibraryPhoto;
  ids: string[];
  onRemove: () => void;
}) {
  const t = useT();
  const [kw, setKw] = useState('');
  const x = p.exif;
  const rows: [string, string | undefined][] = [
    [t('plib.camera'), [x.make, x.model].filter(Boolean).join(' ') || undefined],
    [t('plib.lens'), x.lens],
    [t('plib.exposure'), x.exposure ? formatExposure(x.exposure) : undefined],
    [t('plib.aperture'), x.fNumber ? `f/${Math.round(x.fNumber * 10) / 10}` : undefined],
    [t('plib.iso'), x.iso ? String(x.iso) : undefined],
    [t('plib.focal'), x.focal ? `${Math.round(x.focal)} mm` : undefined],
    [t('plib.date'), new Date(p.date).toLocaleString()],
    [t('plib.dimensions'), `${p.width} × ${p.height} px`],
    [
      t('plib.fileSize'),
      p.size < 1048576 ? `${Math.ceil(p.size / 1024)} Ko` : `${(p.size / 1048576).toFixed(1)} Mo`,
    ],
    [t('plib.folder'), p.folder || t('plib.loose')],
  ];
  const addKeyword = () => {
    const k = cleanKeyword(kw);
    if (k) updatePhotos(ids, (q) => ({ keywords: q.keywords.includes(k) ? q.keywords : [...q.keywords, k] }));
    setKw('');
  };
  return (
    <div className="plib-card-info" data-testid="plib-info">
      <img className="plib-preview" src={p.thumb} alt="" />
      <h3 title={p.name}>{p.name}</h3>
      <div className="plib-row" role="group" aria-label={t('plib.rating')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className="plib-star"
            aria-pressed={p.rating >= n}
            title={t('plib.setRating', { n })}
            aria-label={t('plib.setRating', { n })}
            onClick={() => updatePhotos(ids, () => ({ rating: p.rating === n ? 0 : n }))}
          >
            <Icon name="star" />
          </button>
        ))}
      </div>
      <div className="plib-row">
        <button
          className="ib"
          aria-pressed={p.flag === 'pick'}
          title={t('plib.pick')}
          aria-label={t('plib.pick')}
          onClick={() => updatePhotos(ids, () => ({ flag: p.flag === 'pick' ? null : 'pick' }))}
        >
          <Icon name="flag" />
        </button>
        <button
          className="ib"
          aria-pressed={p.flag === 'reject'}
          title={t('plib.reject')}
          aria-label={t('plib.reject')}
          onClick={() => updatePhotos(ids, () => ({ flag: p.flag === 'reject' ? null : 'reject' }))}
        >
          <Icon name="flagReject" />
        </button>
        <span className="spacer" />
        <div className="plib-labels" role="group" aria-label={t('plib.label')}>
          {LABELS.map((l) => (
            <button
              key={l}
              className={`plib-label ${l}`}
              aria-pressed={p.label === l}
              title={t(`plib.label.${l}`)}
              aria-label={t(`plib.label.${l}`)}
              onClick={() => updatePhotos(ids, () => ({ label: p.label === l ? null : l }))}
            />
          ))}
        </div>
      </div>
      <div className="plib-keywords">
        {p.keywords.map((k) => (
          <button
            key={k}
            className="plib-chip"
            title={t('plib.removeKeyword', { k })}
            aria-label={t('plib.removeKeyword', { k })}
            onClick={() => updatePhotos(ids, (q) => ({ keywords: q.keywords.filter((w) => w !== k) }))}
          >
            {k} <Icon name="close" size={10} />
          </button>
        ))}
        <input
          className="text-input"
          value={kw}
          placeholder={t('plib.addKeyword')}
          aria-label={t('plib.addKeyword')}
          onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addKeyword();
            }
          }}
          onBlur={addKeyword}
        />
      </div>
      <dl className="plib-exif">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <button className="btn primary" onClick={() => void openLibraryPhoto(p)} data-testid="plib-open">
        {isRaw(p.name) ? t('plib.develop') : t('plib.openPhoto')}
      </button>
      <button className="btn" onClick={onRemove}>
        <Icon name="trash" />
        {t('plib.remove')}
      </button>
    </div>
  );
}
