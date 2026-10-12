import { useState } from 'react';
import { documentMasters, documentPages, pageNumber } from '@poulpe/core';
import { Modal } from '../../components/Dialogs';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { applyMaster } from '../../layoutActions';
import { editor, useEditor } from '../../store';
import { addPages, chosenPages, pagesInScope, type MasterScope, type PagePosition } from './pageActions';

/* Fenêtres « Ajouter des pages » et « Appliquer la page maître » du panneau Pages. */

export function AddPagesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { doc, activeArtboardId } = useEditor();
  const pages = documentPages(doc);
  const masters = documentMasters(doc);
  const active = pages.find((p) => p.id === activeArtboardId) ?? pages[pages.length - 1];
  const [count, setCount] = useState(1);
  const [position, setPosition] = useState<PagePosition>('after');
  const [refId, setRefId] = useState(active?.id ?? '');
  const [masterId, setMasterId] = useState(
    active?.masterId && masters.some((m) => m.id === active.masterId) ? active.masterId : '',
  );
  const label = (id: string) => {
    const p = pages.find((a) => a.id === id);
    return p ? `${pageNumber(doc, p)} · ${p.name}` : '';
  };
  return (
    <Modal title={t('frames.addPages').replace('…', '')} onClose={onClose}>
      <div className="frames-dialog">
        <NumberField
          label={t('frames.count')}
          value={count}
          min={1}
          max={500}
          width={110}
          testId="add-pages-count"
          onChange={setCount}
        />
        <Select
          label={t('frames.position')}
          value={position}
          testId="add-pages-position"
          options={(['before', 'after', 'start', 'end'] as const).map((p) => ({
            value: p,
            label: t(`frames.pos.${p}`),
          }))}
          onChange={setPosition}
        />
        <Select
          label={t('frames.page')}
          value={refId}
          testId="add-pages-ref"
          disabled={position === 'start' || position === 'end'}
          options={pages.map((p) => ({ value: p.id, label: label(p.id) }))}
          onChange={setRefId}
        />
        <Select
          label={t('pages.master')}
          value={masterId}
          testId="add-pages-master"
          options={[
            { value: '', label: t('pages.none') },
            ...masters.map((m) => ({ value: m.id, label: m.name })),
          ]}
          onChange={setMasterId}
        />
      </div>
      <footer>
        <button className="btn" onClick={onClose}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="add-pages-go"
          onClick={() => {
            onClose();
            addPages({ count, position, refId: refId || null, masterId: masterId || null });
          }}
        >
          {t('frames.add')}
        </button>
      </footer>
    </Modal>
  );
}

export function ApplyMasterDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { doc } = useEditor();
  const masters = documentMasters(doc);
  const several = chosenPages(doc).length > 1;
  const [masterId, setMasterId] = useState(masters[0]?.id ?? '');
  const [scope, setScope] = useState<MasterScope>(several ? 'chosen' : 'all');
  const [range, setRange] = useState('');
  const targets = pagesInScope(doc, scope, range);
  return (
    <Modal title={t('frames.applyMaster').replace('…', '')} onClose={onClose}>
      <div className="frames-dialog">
        <Select
          label={t('pages.master')}
          value={masterId}
          testId="apply-master-master"
          options={[
            { value: '', label: t('pages.none') },
            ...masters.map((m) => ({ value: m.id, label: m.name })),
          ]}
          onChange={setMasterId}
        />
        <Select
          label={t('frames.scope')}
          value={scope}
          testId="apply-master-scope"
          options={(['chosen', 'all', 'odd', 'even', 'range'] as const).map((s) => ({
            value: s,
            label: t(`frames.scope.${s}`),
          }))}
          onChange={setScope}
        />
        {scope === 'range' && (
          <label className="field">
            <span className="field-label">{t('frames.range')}</span>
            <input
              className="text-input"
              value={range}
              placeholder={t('frames.rangeHint')}
              aria-label={t('frames.range')}
              data-testid="apply-master-range"
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
        )}
        <p className="note small">{t('frames.chosen', { n: targets.length })}</p>
      </div>
      <footer>
        <button className="btn" onClick={onClose}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="apply-master-go"
          disabled={!targets.length}
          onClick={() => {
            onClose();
            applyMaster(masterId || null, pagesInScope(editor.doc, scope, range));
          }}
        >
          {t('frames.apply')}
        </button>
      </footer>
    </Modal>
  );
}
