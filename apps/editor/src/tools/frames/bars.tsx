import { FRAME_FITS, cellRect, cellsIn, frameFit, type FrameFit, type TableNode } from '@poulpe/core';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { useEditor, useStore, useUi } from '../../store';
import {
  cancelPlaceImage,
  centerFrameImage,
  chooseImageForFrame,
  endFrameZoom,
  frameZoom,
  replaceSelectedImage,
  selectedFrame,
  selectedImage,
  setFrameFit,
  setFrameZoom,
  sizeFrameToContent,
  startPlaceImage,
} from './frameActions';
import { framesState } from './state';
import {
  addTableCol,
  addTableRow,
  removeTableCol,
  removeTableRow,
  selectedTable,
  setCellBorder,
  setCellFill,
  setTableGrid,
  setTableHeaderRow,
  targetRange,
} from './tableActions';

/* Barres contextuelles des outils Cadre d'image, Image et Tableau, et réglages ajoutés à la barre
   de l'outil Déplacer quand un cadre d'image, une image ou un tableau est sélectionné. */

function FitSelect({ value }: { value: FrameFit }) {
  const t = useT();
  return (
    <Select
      label={t('frames.fit')}
      value={value}
      testId="frame-fit"
      options={FRAME_FITS.map((f) => ({ value: f, label: t(`frames.fit.${f}`) }))}
      onChange={setFrameFit}
    />
  );
}

/** Réglages d'un cadre d'image sélectionné (ou de son image). */
function FrameControls() {
  const t = useT();
  const { doc, selection } = useEditor();
  const f = selectedFrame(doc, selection);
  if (!f) return null;
  const zoom = frameZoom(doc, selection);
  return (
    <>
      <span className="ctx-label">{t('frames.name')}</span>
      {f.image ? (
        <button className="btn small" data-testid="frame-replace" onClick={() => void replaceSelectedImage()}>
          {t('frames.replace')}
        </button>
      ) : (
        <button
          className="btn small"
          data-testid="frame-place"
          onClick={() => void chooseImageForFrame(f.frame.id)}
        >
          {t('frames.place')}
        </button>
      )}
      <FitSelect value={frameFit(f.frame)} />
      {f.image && zoom !== null && (
        <>
          <label className="field">
            <span className="field-label">{t('frames.zoom')}</span>
            <input
              type="range"
              min={10}
              max={400}
              value={Math.round(zoom * 100)}
              aria-label={t('frames.zoom')}
              data-testid="frame-zoom"
              onChange={(e) => setFrameZoom(Number(e.target.value) / 100, true)}
              onPointerUp={endFrameZoom}
              onKeyUp={endFrameZoom}
              onBlur={endFrameZoom}
            />
          </label>
          <NumberField
            value={Math.round(zoom * 100)}
            min={5}
            max={2000}
            unit="%"
            width={60}
            testId="frame-zoom-value"
            onChange={(v) => setFrameZoom(v / 100)}
          />
          <button className="btn small" data-testid="frame-center" onClick={centerFrameImage}>
            {t('frames.center')}
          </button>
          <button className="btn small" data-testid="frame-to-content" onClick={sizeFrameToContent}>
            {t('frames.toContent')}
          </button>
        </>
      )}
    </>
  );
}

/** Barre des outils Cadre d'image : l'ajustement des prochains cadres (et du cadre sélectionné). */
function FrameToolBar() {
  const t = useT();
  const { doc, selection } = useEditor();
  const fit = useStore(framesState, (s) => s.fit);
  const f = selectedFrame(doc, selection);
  return (
    <>
      {f ? <FrameControls /> : <FitSelect value={fit} />}
      <span className="ctx-dim">{t('frames.frameHint')}</span>
    </>
  );
}

/** Barre de l'outil Image. */
function ImageToolBar() {
  const t = useT();
  const pending = useStore(framesState, (s) => s.pending);
  return (
    <>
      <button className="btn small" data-testid="image-choose" onClick={() => void startPlaceImage()}>
        {t('frames.chooseImage')}
      </button>
      {pending && (
        <>
          <span className="ctx-dim" data-testid="image-pending">
            {pending.width} × {pending.height} px
          </span>
          <button className="btn small" onClick={cancelPlaceImage}>
            {t('frames.cancel')}
          </button>
        </>
      )}
      <span className="ctx-dim">{t(pending ? 'frames.imagePending' : 'frames.imageHint')}</span>
    </>
  );
}

const hex = (p: { type: string; color?: string }) =>
  p.type === 'solid' && p.color ? p.color.slice(0, 7) : '#ffffff';

/** Réglages d'un tableau : lignes, colonnes, en-tête, fond et bordures des cellules choisies. */
function TableControls({ table }: { table: TableNode }) {
  const t = useT();
  useStore(framesState, (s) => s.cells);
  useUi((s) => s.editingTextId);
  const first = cellsIn(table, targetRange(table))[0] ?? { r: 0, c: 0 };
  const rect = cellRect(table, first.r, first.c);
  const border = rect.stroke.paint.type === 'none' ? 0 : rect.stroke.width;
  return (
    <>
      <NumberField
        label={t('frames.rows')}
        value={table.table.rows}
        min={1}
        max={200}
        width={60}
        testId="table-rows"
        onChange={(v) => setTableGrid(v, table.table.cols)}
      />
      <NumberField
        label={t('frames.cols')}
        value={table.table.cols}
        min={1}
        max={50}
        width={60}
        testId="table-cols"
        onChange={(v) => setTableGrid(table.table.rows, v)}
      />
      <span className="ctx-group">
        <button
          className="btn small"
          title={t('frames.addRowTip')}
          data-testid="table-add-row"
          onClick={() => addTableRow('below')}
        >
          {t('frames.addRow')}
        </button>
        <button
          className="btn small"
          title={t('frames.removeRowTip')}
          data-testid="table-remove-row"
          disabled={table.table.rows < 2}
          onClick={removeTableRow}
        >
          {t('frames.removeRow')}
        </button>
        <button
          className="btn small"
          title={t('frames.addColTip')}
          data-testid="table-add-col"
          onClick={() => addTableCol('right')}
        >
          {t('frames.addCol')}
        </button>
        <button
          className="btn small"
          title={t('frames.removeColTip')}
          data-testid="table-remove-col"
          disabled={table.table.cols < 2}
          onClick={removeTableCol}
        >
          {t('frames.removeCol')}
        </button>
      </span>
      <label className="check">
        <input
          type="checkbox"
          data-testid="table-header"
          checked={!!table.table.header}
          onChange={(e) => setTableHeaderRow(e.target.checked)}
        />
        {t('frames.header')}
      </label>
      <label className="field">
        <span className="field-label">{t('frames.cellFill')}</span>
        <input
          type="color"
          className="color-input"
          value={hex(rect.fill)}
          aria-label={t('frames.cellFill')}
          data-testid="table-fill"
          onChange={(e) => setCellFill(e.target.value)}
        />
      </label>
      <button className="btn small" data-testid="table-no-fill" onClick={() => setCellFill(null)}>
        {t('frames.noFill')}
      </button>
      <label className="field">
        <span className="field-label">{t('frames.border')}</span>
        <input
          type="color"
          className="color-input"
          value={hex(rect.stroke.paint)}
          aria-label={t('frames.border')}
          data-testid="table-border-color"
          onChange={(e) => setCellBorder({ borderColor: e.target.value })}
        />
      </label>
      <NumberField
        value={border}
        min={0}
        max={50}
        step={0.5}
        decimals={1}
        unit="px"
        width={60}
        testId="table-border-width"
        onChange={(v) => setCellBorder({ borderWidth: v })}
      />
    </>
  );
}

/** Barre de l'outil Tableau : le tableau sélectionné, ou la grille des prochains tableaux. */
function TableToolBar() {
  const t = useT();
  const { doc, selection } = useEditor();
  useUi((s) => s.editingTextId);
  const rows = useStore(framesState, (s) => s.rows);
  const cols = useStore(framesState, (s) => s.cols);
  const header = useStore(framesState, (s) => s.header);
  const table = selectedTable(doc, selection);
  if (table) return <TableControls table={table} />;
  return (
    <>
      <NumberField
        label={t('frames.rows')}
        value={rows}
        min={1}
        max={200}
        width={60}
        testId="table-rows"
        onChange={(v) => setTableGrid(v, cols)}
      />
      <NumberField
        label={t('frames.cols')}
        value={cols}
        min={1}
        max={50}
        width={60}
        testId="table-cols"
        onChange={(v) => setTableGrid(rows, v)}
      />
      <label className="check">
        <input
          type="checkbox"
          data-testid="table-header"
          checked={header}
          onChange={(e) => setTableHeaderRow(e.target.checked)}
        />
        {t('frames.header')}
      </label>
      <span className="ctx-dim">{t('frames.tableHint')}</span>
    </>
  );
}

const OWN_TOOLS = new Set(['pictureFrameRect', 'pictureFrameEllipse', 'image', 'table']);

/** Ajouté à la barre contextuelle des autres outils : cadre d'image, image ou tableau sélectionné. */
function FramesExtra() {
  const t = useT();
  const { doc, selection } = useEditor();
  const tool = useUi((s) => s.tool);
  const editing = useUi((s) => s.editingTextId);
  const persona = useUi((s) => s.persona);
  if (OWN_TOOLS.has(tool) || persona === 'photo') return null;
  if (selectedFrame(doc, selection)) return <FrameControls />;
  const table = selectedTable(doc, selection);
  if (table && (editing || selection[0] === table.id)) return <TableControls table={table} />;
  if (selectedImage(doc, selection))
    return (
      <button className="btn small" data-testid="frame-replace" onClick={() => void replaceSelectedImage()}>
        {t('frames.replace')}
      </button>
    );
  return null;
}

export const contexts = {
  pictureFrameRect: FrameToolBar,
  pictureFrameEllipse: FrameToolBar,
  image: ImageToolBar,
  table: TableToolBar,
};

export { FramesExtra };
