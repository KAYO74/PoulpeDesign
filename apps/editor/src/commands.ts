import { COLOR_ADJUSTMENTS, LIVE_FILTERS, findNode, topLevelIds, type AdjustmentKind } from '@poulpe/core';
import * as A from './actions';
import type { NodeAction } from './canvas/pathTools';
import { beginTextEdit, endTextEdit, isEditingText } from './canvas/textEdit';
import { getController } from './components/Viewport';
import { t, type MessageKey } from './i18n';
import { isRecording, recordStep } from './macros/recorder';
import { beginRecording, endRecording } from './macros/macros';
import { shortcutOf } from './shortcuts';
import {
  commandsVersion,
  dynamicCommand,
  dynamicCommands,
  registerCommand,
  subscribeCommands,
  unregisterCommand,
} from './registry';
import { exportDocument, importImage, isDesktop, openDocument, saveDocument, savePsdDocument } from './io';
import { startPlaceImage } from './tools/frames/frameActions';
import { duplicateWithRepeat } from './tools/move/actions';
import { checkForUpdates } from './updater';
import * as V from './vectorActions';
import * as L from './layoutActions';
import * as S from './symbolActions';
import * as TX from './tools/text/actions';
import { editor, isBrushTool, setBrush, setSettings, setTool, ui, type Persona, type ToolId } from './store';
import * as P from './photo/photoActions';
import { clearSelection, invertSelection, selectAll, selectFromLayer } from './photo/selection';
import { images, newPixelLayer, selectedImage } from './photo/pixels';
import { openPhoto } from './photo/persona';
import { canCutout, removeBackground, selectSubject } from './smart/cutout';
import { canVectorize } from './smart/vectorize';
import { addLutPreset, loadLutFile } from './photo/retouchActions';
import { addLiveFilter, canLiveFilter } from './photo/liveFilters';
import * as LK from './photo/linkedImages';
import { openContentFill } from './photo/contentFill';
import { exportSlices, sliceFileCount, slicesFromArtboards, slicesFromSelection } from './slices';
import { takeSnapshot } from './snapshots';
import { saveSelectionAsChannel } from './photo/channels';
import { canMeshWarp, openMeshWarp } from './photo/meshWarp';
import { blendTargets, openBlendRanges } from './components/dialogs/BlendRangesDialog';
import { toggleQuickMask } from './tools/pixel/quickMask';
import { resetPanels } from './panels/panelLayout';
import { toggleColorWindow } from './panels/ColorWindow';
import { toggleBrushEditor } from './tools/brushes/BrushEditor';
import { openPersona } from './workspaces';
import { PRESET_KEYS } from './toolKeyPresets';
import { selectAdjacentLayer } from './layers';
import { LUT_PRESETS, type LutPreset } from '@poulpe/core';

export interface Command {
  label: MessageKey;
  /** Nom affiché d'une commande ajoutée par une macro ou une extension (à la place de `label`). */
  title?: string;
  /** Raccourci au format « Mod+Shift+Z » (Mod = Ctrl, ou Cmd sur macOS). */
  shortcut?: string;
  /** Peut renvoyer une promesse (détourage…) : la lecture d'une macro l'attend. */
  run: () => unknown;
  enabled?: () => boolean;
  /** Commande propre à une Persona : son raccourci n'agit que dans celle-ci, et seulement si elle est disponible. */
  persona?: Persona;
}

const photoSel = () => ui.get().hasPixelSelection;
/** Outil Nœud : un tracé est en cours d'édition (avec des nœuds sélectionnés). */
const nodePath = () => !!getController()?.paths.editablePath();
const nodeSel = () => nodePath() && ui.get().nodeSelection.length > 0;
const nodeRun = (kind: NodeAction) => () => getController()?.paths.editNodes(kind);
const pixelSel = () => photoSel() && selectedImage() !== null;

/** Une commande par réglage (calque de réglage) et par filtre (appliqué aux pixels). */
function adjustmentCommands() {
  const out: Record<string, Command> = {};
  for (const kind of [...COLOR_ADJUSTMENTS, ...LIVE_FILTERS] as AdjustmentKind[]) {
    out[`adjust.${kind}`] = { label: `adjust.${kind}` as MessageKey, run: () => P.addAdjustment(kind) };
    out[`filter.${kind}`] = {
      label: `adjust.${kind}` as MessageKey,
      run: () => ui.set({ dialog: 'filter', filterKind: kind }),
      enabled: P.canFilter,
    };
    out[`livefilter.${kind}`] = {
      label: `adjust.${kind}` as MessageKey,
      run: () => addLiveFilter(kind),
      enabled: canLiveFilter,
    };
  }
  return out as Record<
    `adjust.${AdjustmentKind}` | `filter.${AdjustmentKind}` | `livefilter.${AdjustmentKind}`,
    Command
  >;
}

/** Une commande par look intégré (table LUT calculée). */
function lutCommands() {
  const out: Record<string, Command> = {};
  for (const preset of Object.keys(LUT_PRESETS) as LutPreset[])
    out[`lut.${preset}`] = { label: `lut.${preset}` as MessageKey, run: () => addLutPreset(preset) };
  return out as Record<`lut.${LutPreset}`, Command>;
}

const hasSel = () => editor.selection.length > 0;
const selType = () =>
  editor.selection.length === 1 ? findNode(editor.doc, editor.selection[0])?.node.type : undefined;

const zoomBy = (k: number) => {
  const c = getController();
  if (c) c.zoomAt(ui.get().view.zoom * k);
};

export const COMMANDS = {
  'file.new': { label: 'file.new', shortcut: 'Mod+N', run: () => ui.set({ dialog: 'new' }) },
  'file.open': { label: 'file.open', shortcut: 'Mod+O', run: () => void openDocument() },
  'file.save': { label: 'file.save', shortcut: 'Mod+S', run: () => void saveDocument() },
  'file.saveAs': { label: 'file.saveAs', shortcut: 'Mod+Shift+S', run: () => void saveDocument(true) },
  'file.saveAsPsd': { label: 'file.saveAsPsd', run: () => void savePsdDocument() },
  'file.importImage': { label: 'file.importImage', shortcut: 'Mod+Shift+I', run: () => void importImage() },
  'file.placeLinked': {
    label: 'link.place',
    run: () => LK.placeLinkedImage(),
    enabled: LK.canPlaceLinked,
  },
  'file.openPhoto': { label: 'file.openPhoto', shortcut: 'Mod+Alt+O', run: () => void openPhoto() },
  'file.photoLibrary': {
    label: 'plib.open',
    shortcut: 'Mod+Alt+B',
    run: () => ui.set((s) => ({ photoLibrary: !s.photoLibrary, dialog: null })),
  },
  'file.export': { label: 'file.export', shortcut: 'Mod+Shift+E', run: () => ui.set({ dialog: 'export' }) },
  'file.saveTemplate': { label: 'mytpl.save', run: () => ui.set({ dialog: 'saveTemplate' }) },
  'file.batchExport': { label: 'file.batchExport', run: () => ui.set({ dialog: 'batch' }) },
  'file.exportPng': {
    label: 'file.exportPng',
    run: () =>
      void exportDocument({
        kind: 'png',
        artboardId: editor.getState().activeArtboardId,
        scale: 1,
        quality: 0.92,
        transparent: false,
      }),
  },

  'edit.undo': {
    label: 'edit.undo',
    shortcut: 'Mod+Z',
    run: () => editor.undo(),
    enabled: () => editor.getState().canUndo,
  },
  'edit.redo': {
    label: 'edit.redo',
    shortcut: 'Mod+Shift+Z',
    run: () => editor.redo(),
    enabled: () => editor.getState().canRedo,
  },
  'history.snapshot': { label: 'snapshot.new', run: () => takeSnapshot() },
  'edit.cut': { label: 'edit.cut', shortcut: 'Mod+X', run: A.cutSelection, enabled: hasSel },
  'edit.copy': { label: 'edit.copy', shortcut: 'Mod+C', run: A.copySelection, enabled: hasSel },
  'edit.paste': { label: 'edit.paste', shortcut: 'Mod+V', run: A.paste, enabled: A.hasClipboard },
  'edit.duplicate': {
    label: 'edit.duplicate',
    shortcut: 'Mod+J',
    // Répète la transformation faite sur la copie précédente (duplication intelligente).
    run: duplicateWithRepeat,
    enabled: hasSel,
  },
  'edit.delete': { label: 'edit.delete', shortcut: 'Delete', run: A.deleteSelection, enabled: hasSel },
  'edit.selectAll': { label: 'edit.selectAll', shortcut: 'Mod+A', run: A.selectAll },
  'edit.deselect': {
    label: 'edit.deselect',
    shortcut: 'Mod+Shift+A',
    run: () => editor.select([]),
    enabled: hasSel,
  },

  // ————— Persona Photo —————
  'select.all': { label: 'select.all', shortcut: 'Mod+A', persona: 'photo', run: selectAll },
  'select.deselect': {
    label: 'select.deselect',
    shortcut: 'Mod+D',
    persona: 'photo',
    run: clearSelection,
    enabled: photoSel,
  },
  'select.invert': {
    label: 'select.invert',
    shortcut: 'Mod+Shift+I',
    persona: 'photo',
    run: invertSelection,
  },
  'select.feather': {
    label: 'select.feather',
    run: () => ui.set({ dialog: 'selectionModify', selectionModify: 'feather' }),
    enabled: photoSel,
  },
  'select.grow': {
    label: 'select.grow',
    run: () => ui.set({ dialog: 'selectionModify', selectionModify: 'grow' }),
    enabled: photoSel,
  },
  'select.shrink': {
    label: 'select.shrink',
    run: () => ui.set({ dialog: 'selectionModify', selectionModify: 'shrink' }),
    enabled: photoSel,
  },
  'select.quickMask': {
    label: 'select.quickMask' as MessageKey,
    shortcut: 'Q',
    persona: 'photo',
    run: toggleQuickMask,
    enabled: () => ui.get().persona === 'photo',
  },
  'select.saveChannel': { label: 'channels.save', run: saveSelectionAsChannel, enabled: photoSel },
  'select.fromLayer': {
    label: 'select.fromLayer',
    run: () => {
      const n = selectedImage();
      if (n) selectFromLayer(n, images());
    },
    enabled: () => selectedImage() !== null,
  },
  'edit.clearPixels': {
    label: 'edit.clearPixels',
    shortcut: 'Delete',
    persona: 'photo',
    run: () => void P.clearSelectedPixels(),
    enabled: pixelSel,
  },
  'edit.contentAwareFill': {
    label: 'edit.contentAwareFill',
    run: () => openContentFill(),
    enabled: pixelSel,
  },
  'layer.copyToLayer': {
    label: 'layer.copyToLayer',
    shortcut: 'Mod+J',
    persona: 'photo',
    run: () => void P.copySelectionToLayer(),
    enabled: pixelSel,
  },
  'layer.newPixel': {
    label: 'layer.newPixel',
    shortcut: 'Mod+Shift+N',
    run: () => void newPixelLayer(),
  },
  'layer.addMask': { label: 'layer.addMask', run: () => P.addMask(), enabled: P.canAddMask },
  'layer.editMask': {
    label: 'layer.editMask',
    run: () => P.toggleMaskEdit(),
    enabled: () => {
      const n = P.selectedNode();
      return !!n && n.type !== 'group';
    },
  },
  'layer.toggleMask': { label: 'layer.toggleMask', run: P.toggleMask, enabled: P.hasMask },
  'layer.invertMask': { label: 'layer.invertMask', run: P.invertMask, enabled: P.hasMask },
  'layer.removeMask': { label: 'layer.removeMask', run: P.removeMask, enabled: P.hasMask },
  'layer.rasterize': { label: 'layer.rasterize', run: P.rasterizeSelection, enabled: P.canRasterize },
  'slices.fromSelection': {
    label: 'slices.fromSelection',
    run: slicesFromSelection,
    enabled: () => editor.selection.length > 0,
  },
  'slices.fromArtboards': { label: 'slices.fromArtboards', run: slicesFromArtboards },
  'slices.export': {
    label: 'slices.exportCmd',
    run: () => exportSlices(),
    enabled: () => sliceFileCount(editor.doc) > 0,
  },
  'layer.meshWarp': { label: 'warp.menu', run: openMeshWarp, enabled: canMeshWarp },
  'layer.blendRanges': {
    label: 'blend.menu',
    run: openBlendRanges,
    enabled: () => blendTargets().length > 0,
  },
  'layer.replaceImage': { label: 'link.replace', run: () => LK.replaceImage(), enabled: LK.canReplaceImage },
  'layer.embedImage': { label: 'link.embed', run: LK.embedImages, enabled: LK.canEmbedImage },
  'layer.updateLinks': {
    label: 'link.update',
    run: () => LK.updateLinkedImages(true),
    enabled: LK.hasLinkedImages,
  },
  'image.vectorize': {
    label: 'image.vectorize',
    run: () => ui.set({ dialog: 'vectorize' }),
    enabled: canVectorize,
  },
  'image.removeBackground': {
    label: 'image.removeBackground',
    run: () => void removeBackground(),
    enabled: canCutout,
  },
  'select.subject': { label: 'select.subject', run: () => void selectSubject(), enabled: canCutout },
  'layer.mergeVisible': { label: 'layer.mergeVisible', shortcut: 'Mod+Alt+Shift+E', run: P.mergeVisible },
  'layer.mergeSelected': {
    label: 'layer.mergeSelected',
    shortcut: 'Mod+E',
    run: P.mergeSelected,
    enabled: () => topLevelIds(editor.doc, editor.selection).length >= 2,
  },
  'adjust.auto': { label: 'adjust.auto', run: P.addAutoLevels },
  ...adjustmentCommands(),
  ...lutCommands(),
  'lut.load': { label: 'lut.load', run: () => void loadLutFile() },
  'persona.draw': { label: 'persona.draw', run: () => openPersona('draw') },
  'persona.photo': { label: 'persona.photo', run: () => openPersona('photo') },

  'layer.group': { label: 'layer.group', shortcut: 'Mod+G', run: A.groupSelection, enabled: hasSel },
  'layer.ungroup': {
    label: 'layer.ungroup',
    shortcut: 'Mod+Shift+G',
    run: A.ungroupSelection,
    enabled: () => selType() === 'group',
  },
  'layer.clip': {
    label: 'layer.clip',
    shortcut: 'Mod+Alt+G',
    run: A.toggleClipMask,
    enabled: () => editor.selection.length > 1 || selType() === 'group',
  },
  'layer.lock': {
    label: 'layer.lock',
    shortcut: 'Mod+L',
    run: () => {
      const lock = !editor.selection.every((id) => findNode(editor.doc, id)?.node.locked);
      A.updateSelected('history.lock', (n) => void (n.locked = lock));
    },
    enabled: hasSel,
  },
  'layer.hide': {
    label: 'layer.hide',
    shortcut: 'Mod+Shift+H',
    run: () => {
      A.updateSelected('history.visibility', (n) => void (n.visible = false));
      editor.select([]);
    },
    enabled: hasSel,
  },

  'layer.convertToCurves': {
    label: 'layer.convertToCurves',
    shortcut: 'Mod+Enter',
    run: () => void V.convertToCurves(),
    enabled: V.canConvertToCurves,
  },
  'node.sharp': { label: 'node.sharp', run: nodeRun('sharp'), enabled: nodeSel },
  'node.smooth': { label: 'node.smooth', run: nodeRun('smooth'), enabled: nodeSel },
  'node.smart': { label: 'node.smart', run: nodeRun('smart'), enabled: nodeSel },
  'node.split': { label: 'node.split', run: nodeRun('split'), enabled: nodeSel },
  'node.break': { label: 'node.break', run: nodeRun('break'), enabled: nodeSel },
  'node.close': { label: 'node.close', run: nodeRun('toggleClosed'), enabled: nodePath },
  'node.smoothCurve': { label: 'node.smoothCurve', run: nodeRun('smoothCurve'), enabled: nodePath },
  'node.join': {
    label: 'node.join',
    run: nodeRun('join'),
    enabled: () => nodePath() || (ui.get().tool === 'direct' && editor.selection.length > 1),
  },
  'node.reverse': { label: 'node.reverse', run: nodeRun('reverse'), enabled: nodePath },
  'node.delete': { label: 'node.delete', run: nodeRun('delete'), enabled: nodeSel },
  'node.fitDelete': { label: 'node.fitDelete', run: nodeRun('fitDelete'), enabled: nodeSel },
  'layer.outlineStroke': {
    label: 'layer.outlineStroke',
    run: V.outlineStroke,
    enabled: V.canOutlineStroke,
  },
  'layer.offset': {
    label: 'layer.offset',
    run: () => ui.set({ dialog: 'offset' }),
    enabled: () => editor.selection.length > 0,
  },
  'geometry.unite': { label: 'geometry.unite', run: () => V.booleanOp('unite'), enabled: V.canBoolean },
  'geometry.subtract': {
    label: 'geometry.subtract',
    run: () => V.booleanOp('subtract'),
    enabled: V.canBoolean,
  },
  'geometry.intersect': {
    label: 'geometry.intersect',
    run: () => V.booleanOp('intersect'),
    enabled: V.canBoolean,
  },
  'geometry.exclude': { label: 'geometry.exclude', run: () => V.booleanOp('exclude'), enabled: V.canBoolean },
  'geometry.divide': { label: 'geometry.divide', run: () => V.booleanOp('divide'), enabled: V.canBoolean },

  'symbol.create': { label: 'symbol.create', run: S.createSymbol, enabled: S.canMakeSymbol },
  'symbol.detach': { label: 'symbol.detach', run: S.detachSymbol, enabled: S.canDetachSymbol },
  'symbol.update': { label: 'symbol.update', run: S.updateSymbol, enabled: S.canUpdateSymbol },
  'style.save': { label: 'style.save', run: S.saveStyle, enabled: S.canSaveStyle },

  'text.onPath': { label: 'text.onPath', run: V.placeTextOnPath, enabled: V.canPlaceOnPath },
  'text.offPath': {
    label: 'text.offPath',
    run: V.removeTextFromPath,
    enabled: () => V.selectedPathText() !== null,
  },
  'text.toCurves': {
    label: 'text.toCurves',
    run: () => void V.convertToCurves(),
    enabled: () =>
      editor.selection.some((id) => {
        const n = findNode(editor.doc, id)?.node;
        return n?.type === 'text' && !n.locked;
      }),
  },

  'text.pageNumber': { label: 'text.pageNumber', run: L.insertPageNumber },
  'text.frame': { label: 'text.frame', run: L.toggleFrame, enabled: L.canToggleFrame },
  'text.link': { label: 'text.link', run: L.linkSelection, enabled: L.canLinkSelection },
  'text.unlink': { label: 'text.unlink', run: L.unlinkSelected, enabled: L.canUnlink },
  // Mise en forme du texte (tools/text) : aussi pendant l'édition, sur la sélection dans le texte.
  'text.bold': {
    label: 'text.bold' as MessageKey,
    shortcut: 'Mod+B',
    run: TX.toggleBold,
    enabled: TX.canFormatText,
  },
  'text.italic': {
    label: 'text.italic' as MessageKey,
    shortcut: 'Mod+I',
    run: TX.toggleItalic,
    enabled: TX.canFormatText,
  },
  'text.underline': {
    label: 'text.underline' as MessageKey,
    shortcut: 'Mod+U',
    run: TX.toggleUnderline,
    enabled: TX.canFormatText,
  },
  'text.biggerFont': {
    label: 'text.biggerFont' as MessageKey,
    shortcut: 'Mod+Shift+>',
    run: () => TX.stepFontSize(1),
    enabled: TX.canFormatText,
  },
  'text.smallerFont': {
    label: 'text.smallerFont' as MessageKey,
    shortcut: 'Mod+Shift+<',
    run: () => TX.stepFontSize(-1),
    enabled: TX.canFormatText,
  },
  'text.alignLeft': {
    label: 'text.alignLeft' as MessageKey,
    shortcut: 'Mod+Alt+L',
    run: () => TX.setAlign('left'),
    enabled: TX.canFormatText,
  },
  'text.alignCenter': {
    label: 'text.alignCenter' as MessageKey,
    shortcut: 'Mod+Alt+C',
    run: () => TX.setAlign('center'),
    enabled: TX.canFormatText,
  },
  'text.alignRight': {
    label: 'text.alignRight' as MessageKey,
    shortcut: 'Mod+Alt+R',
    run: () => TX.setAlign('right'),
    enabled: TX.canFormatText,
  },
  'text.justify': {
    label: 'text.justify' as MessageKey,
    shortcut: 'Mod+Alt+J',
    run: () => TX.setAlign('justify'),
    enabled: TX.canFormatText,
  },

  'arrange.front': {
    label: 'arrange.front',
    shortcut: 'Mod+Shift+]',
    run: () => A.reorder('front'),
    enabled: hasSel,
  },
  'arrange.forward': {
    label: 'arrange.forward',
    shortcut: 'Mod+]',
    run: () => A.reorder('forward'),
    enabled: hasSel,
  },
  'arrange.backward': {
    label: 'arrange.backward',
    shortcut: 'Mod+[',
    run: () => A.reorder('backward'),
    enabled: hasSel,
  },
  'arrange.back': {
    label: 'arrange.back',
    shortcut: 'Mod+Shift+[',
    run: () => A.reorder('back'),
    enabled: hasSel,
  },
  'layer.selectAbove': {
    label: 'layer.selectAbove',
    shortcut: 'Alt+]',
    run: () => selectAdjacentLayer(-1),
  },
  'layer.selectBelow': {
    label: 'layer.selectBelow',
    shortcut: 'Alt+[',
    run: () => selectAdjacentLayer(1),
  },
  'arrange.alignLeft': { label: 'arrange.alignLeft', run: () => A.align('left'), enabled: hasSel },
  'arrange.alignHCenter': { label: 'arrange.alignHCenter', run: () => A.align('hcenter'), enabled: hasSel },
  'arrange.alignRight': { label: 'arrange.alignRight', run: () => A.align('right'), enabled: hasSel },
  'arrange.alignTop': { label: 'arrange.alignTop', run: () => A.align('top'), enabled: hasSel },
  'arrange.alignVCenter': { label: 'arrange.alignVCenter', run: () => A.align('vcenter'), enabled: hasSel },
  'arrange.alignBottom': { label: 'arrange.alignBottom', run: () => A.align('bottom'), enabled: hasSel },
  'arrange.distributeH': {
    label: 'arrange.distributeH',
    run: () => A.distribute('h'),
    enabled: () => editor.selection.length > 2,
  },
  'arrange.distributeV': {
    label: 'arrange.distributeV',
    run: () => A.distribute('v'),
    enabled: () => editor.selection.length > 2,
  },
  'arrange.flipH': { label: 'arrange.flipH', run: () => A.flipSelection('h'), enabled: hasSel },
  'arrange.flipV': { label: 'arrange.flipV', run: () => A.flipSelection('v'), enabled: hasSel },
  'arrange.rotateLeft': { label: 'arrange.rotateLeft', run: () => A.rotateSelection(-90), enabled: hasSel },
  'arrange.rotateRight': { label: 'arrange.rotateRight', run: () => A.rotateSelection(90), enabled: hasSel },

  'document.addArtboard': { label: 'document.addArtboard', run: () => A.addArtboard() },
  'document.resize': { label: 'document.resize', run: () => ui.set({ dialog: 'resize' }) },
  'document.imageSize': { label: 'document.imageSize', run: () => ui.set({ dialog: 'imageSize' }) },
  'document.canvasSize': { label: 'document.canvasSize', run: () => ui.set({ dialog: 'canvasSize' }) },
  'document.deleteArtboard': {
    label: 'document.deleteArtboard',
    run: () => A.deleteArtboard(),
    enabled: () => editor.doc.artboards.length > 1,
  },

  'document.setup': { label: 'cmd.documentSetup', run: () => ui.set({ dialog: 'document' }) },
  'pages.add': { label: 'pages.add', run: L.addPage },
  'pages.duplicate': { label: 'pages.duplicate', run: () => L.duplicatePage() },
  'pages.delete': { label: 'pages.delete', run: () => L.deletePage(), enabled: () => L.canDeletePage() },
  'pages.addMaster': { label: 'pages.addMaster', run: L.addMaster },
  'pages.arrange': { label: 'pages.arrange', run: L.arrange },
  'persona.layout': { label: 'persona.layout', run: () => openPersona('layout') },
  'persona.export': { label: 'persona.export', run: () => openPersona('export') },

  'view.zoomIn': { label: 'view.zoomIn', shortcut: 'Mod+=', run: () => zoomBy(1.25) },
  'view.zoomOut': { label: 'view.zoomOut', shortcut: 'Mod+-', run: () => zoomBy(0.8) },
  'view.zoomFit': { label: 'view.zoomFit', shortcut: 'Mod+0', run: () => getController()?.zoomToFit() },
  'view.zoom100': {
    label: 'view.zoom100',
    shortcut: 'Mod+1',
    run: () => getController()?.zoomAt(1),
  },
  'view.library': {
    label: 'view.library',
    shortcut: 'Mod+Shift+L',
    run: () => setSettings({ library: !ui.get().settings.library }),
  },
  'view.rulers': {
    label: 'view.rulers',
    shortcut: 'Mod+R',
    run: () => setSettings({ rulers: !ui.get().settings.rulers }),
  },
  'view.grid': {
    label: 'view.grid',
    shortcut: "Mod+'",
    run: () => setSettings({ grid: !ui.get().settings.grid }),
  },
  'view.clearGuides': {
    label: 'cmd.clearGuides',
    enabled: () => !!(editor.doc.guides?.x.length || editor.doc.guides?.y.length),
    run: () => editor.apply('history.guide', (d) => void delete d.guides),
  },
  'view.softProof': {
    label: 'view.softProof',
    shortcut: 'Mod+Y',
    run: () => ui.set({ softProof: !ui.get().softProof }),
  },
  'view.snapping': {
    label: 'view.snapping',
    run: () => setSettings({ snapping: !ui.get().settings.snapping }),
  },
  'view.toolsSide': {
    label: 'view.toolsSide',
    run: () => setSettings({ toolsSide: ui.get().settings.toolsSide === 'right' ? 'left' : 'right' }),
  },
  'view.studioSide': {
    label: 'view.studioSide',
    run: () => setSettings({ studioSide: ui.get().settings.studioSide === 'right' ? 'left' : 'right' }),
  },
  'view.colorPicker': { label: 'view.colorPicker', run: () => toggleColorWindow() },
  'view.brushEditor': { label: 'view.brushEditor', run: () => toggleBrushEditor() },
  'view.resetPanels': { label: 'view.resetPanels', run: () => resetPanels() },

  'ai.assistant': { label: 'ai.assistant', run: () => ui.set({ dialog: 'ai' }) },
  'ai.image': { label: 'ai.image', run: () => ui.set({ dialog: 'aiImage' }) },
  'ai.settings': { label: 'ai.settings', run: () => ui.set({ dialog: 'preferences', prefsTab: 'ai' }) },
  'app.preferences': {
    label: 'prefs.menu',
    shortcut: 'Mod+,',
    run: () => ui.set({ dialog: 'preferences' }),
  },
  'help.docs': {
    label: 'help.docs',
    shortcut: 'F1',
    run: () => ui.set({ dialog: 'help', helpTab: 'start' }),
  },
  'help.faq': { label: 'help.faq', run: () => ui.set({ dialog: 'help', helpTab: 'faq' }) },
  'help.settings': {
    label: 'help.settings',
    run: () => ui.set({ dialog: 'preferences' }),
  },
  'help.diagnostic': {
    label: 'help.diagnostic',
    run: () => ui.set({ dialog: 'preferences', prefsTab: 'diagnostic' }),
  },
  'help.shortcuts': {
    label: 'help.shortcuts',
    shortcut: 'Mod+/',
    run: () => ui.set({ dialog: 'shortcuts' }),
  },
  'help.search': {
    label: 'help.search',
    shortcut: 'Mod+K',
    run: () => ui.set({ dialog: 'palette' }),
  },
  'help.about': { label: 'help.about', run: () => ui.set({ dialog: 'about' }) },
  'help.whatsNew': { label: 'help.whatsNew', run: () => ui.set({ whatsNewOpen: true }) },
  'help.checkUpdates': {
    label: 'help.checkUpdates',
    run: () => void checkForUpdates(),
    enabled: isDesktop,
  },
  'extensions.manage': { label: 'extensions.manage', run: () => ui.set({ dialog: 'extensions' }) },
  'macro.record': {
    label: 'macro.recordCommand',
    run: () => (isRecording() ? void endRecording() : beginRecording()),
  },
} satisfies Record<string, Command>;

export type CommandId = keyof typeof COMMANDS;

export function command(id: CommandId): Command {
  return COMMANDS[id];
}

// ————— Commandes ajoutées pendant l'exécution (macros, extensions) —————

export { registerCommand, unregisterCommand, subscribeCommands, commandsVersion };

/** Toutes les commandes : celles de l'appli puis celles des macros et extensions. */
export function allCommands(): [string, Command][] {
  return [...(Object.entries(COMMANDS) as [string, Command][]), ...dynamicCommands()];
}

export function findCommand(id: string): Command | undefined {
  return (COMMANDS as Record<string, Command>)[id] ?? dynamicCommand(id);
}

export function commandTitle(cmd: Command): string {
  return cmd.title ?? t(cmd.label);
}

/** Raccourci en vigueur d'une commande (personnalisé ou par défaut). */
export function commandShortcut(id: string): string | undefined {
  return shortcutOf(id, findCommand(id)?.shortcut);
}

/** Commandes qu'une macro ne rejoue pas : fichiers, affichage, aide, historique. */
function recordable(id: string): boolean {
  return (
    !/^(file|view|help|persona|history)\.|^macro[:.]/.test(id) && id !== 'edit.undo' && id !== 'edit.redo'
  );
}

/**
 * Exécute une commande (menu, raccourci, bouton), et la note si une macro s'enregistre. Une
 * commande qui ouvre une boîte de dialogue n'est pas notée : c'est la validation de la boîte qui
 * l'est (filtre, décalage…), avec ses réglages.
 */
export function runCommand(id: string): unknown {
  const cmd = findCommand(id);
  if (!cmd || (cmd.enabled && !cmd.enabled())) return undefined;
  const dialogBefore = ui.get().dialog;
  const result = cmd.run();
  if (recordable(id) && !id.startsWith('ext:') && (ui.get().dialog === dialogBefore || !ui.get().dialog))
    recordStep({ kind: 'command', id });
  return result;
}

/*
 * Raccourcis d'outils, sans modificateur, ceux d'Affinity (Designer, Publisher et Photo). Une
 * touche partagée par plusieurs outils passe de l'un à l'autre à chaque appui, comme dans Affinity.
 */

/** Persona Dessin (Affinity Designer). */
export const TOOL_KEYS: Record<string, ToolId[]> = {
  v: ['select'],
  a: ['direct'],
  c: ['corner'],
  p: ['pen'],
  n: ['pencil'],
  b: ['vectorBrush'],
  k: ['knife'],
  u: ['rect', 'roundRect', 'ellipse'],
  e: ['ellipse'],
  l: ['line'],
  s: ['shapeBuilder'],
  o: ['contour'],
  w: ['strokeWidth'],
  g: ['gradient'],
  y: ['transparency'],
  r: ['vectorFill'],
  t: ['text', 'frameText'],
  i: ['eyedropper', 'stylePicker'],
  h: ['hand'],
  z: ['zoom'],
};

/** Persona Mise en page (Affinity Publisher). */
export const LAYOUT_TOOL_KEYS: Record<string, ToolId[]> = {
  v: ['select'],
  a: ['direct'],
  t: ['frameText', 'text', 'table'],
  f: ['pictureFrameRect', 'pictureFrameEllipse'],
  p: ['pen'],
  u: ['rect', 'roundRect', 'ellipse'],
  e: ['ellipse'],
  l: ['line'],
  g: ['gradient'],
  y: ['transparency'],
  i: ['eyedropper', 'stylePicker'],
  h: ['hand'],
  z: ['zoom'],
};

/** Persona Photo (Affinity Photo). */
export const PHOTO_TOOL_KEYS: Record<string, ToolId[]> = {
  v: ['select'],
  c: ['crop', 'straighten'],
  m: ['marqueeRect', 'marqueeEllipse'],
  l: ['lasso'],
  w: ['quickSelect', 'magicWand'],
  b: ['brush'],
  r: ['colorReplace'],
  e: ['eraser', 'backgroundEraser', 'floodEraser'],
  g: ['fill', 'pixelGradient'],
  j: ['magicEraser', 'heal', 'patch', 'blemish', 'redEye'],
  k: ['clone'],
  s: ['smudge'],
  o: ['dodge', 'burn', 'sponge'],
  t: ['text', 'frameText'],
  i: ['eyedropper'],
  h: ['hand'],
  z: ['zoom'],
};

export function toolKeysFor(persona: Persona): Record<string, ToolId[]> {
  const preset = ui.get().settings.keyPreset;
  const group = persona === 'photo' ? 'photo' : persona === 'layout' ? 'layout' : 'draw';
  if (preset && preset !== 'affinity' && PRESET_KEYS[preset]) return PRESET_KEYS[preset][group];
  return persona === 'photo' ? PHOTO_TOOL_KEYS : persona === 'layout' ? LAYOUT_TOOL_KEYS : TOOL_KEYS;
}

/** Touche d'un outil dans une Persona (affichée dans les bulles d'aide), ou undefined. */
export function toolKeyOf(id: ToolId, persona: Persona): string | undefined {
  const hit = Object.entries(toolKeysFor(persona)).find(([, tools]) => tools.includes(id));
  return hit?.[0].toUpperCase();
}

/** Outil choisi par une touche : le suivant de la famille si l'outil actif en fait déjà partie. */
function toolForKey(tools: ToolId[], current: ToolId): ToolId {
  const i = tools.indexOf(current);
  return i >= 0 ? tools[(i + 1) % tools.length] : tools[0];
}

/**
 * Touche d'outil maintenue : si l'on se sert de l'outil sur le canevas pendant qu'elle est
 * enfoncée, on revient à l'outil précédent en la lâchant (outil temporaire, comme dans Affinity).
 * Lâchée pendant un geste, l'outil précédent revient à la fin du geste (`released`). Main et Zoom
 * maintenus ne changent que la vue (`view`, comme Espace) : l'outil en cours garde son travail
 * (contour magnétique, tracé, pièce, aperçu du recadrage).
 */
let held: {
  key: string;
  prev: ToolId;
  used: boolean;
  released: boolean;
  view: 'hand' | 'zoom' | null;
} | null = null;

function restoreHeld(): void {
  if (!held?.released || getController()?.busy()) return;
  const { prev } = held;
  held = null;
  setTool(prev);
}

function dropHeldView(): void {
  if (!held?.view) return;
  held = null;
  getController()?.setHeldView(null);
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (held && e.target === getController()?.canvas) held.used = true;
    },
    true,
  );
  // Fin du geste en cours (dessiné juste après) : l'outil lâché pendant le geste revient.
  window.addEventListener('poulpe:drawn', restoreHeld);
  window.addEventListener('blur', dropHeldView);
}

export function handleKeyUp(e: KeyboardEvent): void {
  if (!held || held.released || e.key.toLowerCase() !== held.key) return;
  const h = held;
  if (h.view) {
    dropHeldView();
    // Simple appui : l'outil Main ou Zoom reste choisi.
    if (!h.used) setTool(h.view);
    return;
  }
  if (!h.used) {
    held = null;
    return;
  }
  h.released = true;
  restoreHeld();
}

/**
 * Touches 1 à 0 : opacité de la sélection (ou du pinceau en Persona Photo), 1 = 10 %, 0 = 100 %.
 * Deux chiffres tapés vite donnent une valeur précise (4 puis 5 = 45 %), comme dans Affinity.
 */
let lastDigit: { digit: string; at: number } | null = null;
function opacityKey(e: KeyboardEvent): boolean {
  if (e.shiftKey || !/^(Digit|Numpad)\d$/.test(e.code)) return false;
  // Touche maintenue : la répétition ne combine pas deux chiffres et n'ajoute pas d'étapes.
  if (e.repeat) return true;
  const d = e.code.slice(-1);
  const now = performance.now();
  const quick = lastDigit && now - lastDigit.at < 600;
  const value = quick ? Number(lastDigit!.digit + d) : d === '0' ? 100 : Number(d) * 10;
  lastDigit = quick ? null : { digit: d, at: now };
  const tool = ui.get().tool;
  if (ui.get().persona === 'photo' && isBrushTool(tool)) {
    setBrush({ opacity: value });
    return true;
  }
  if (!editor.selection.length) return false;
  A.updateSelected('history.style', (n) => void (n.opacity = value / 100));
  return true;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatShortcut(s: string): string {
  return s
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Maj')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Delete', isMac ? '⌫' : 'Suppr')
    .replace(/\+/g, isMac ? '' : '+')
    .replace(/(Ctrl|Maj|Alt)(?=[^+])/g, '$1+');
}

export function matches(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop()!;
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if (mod !== (isMac ? e.metaKey : e.ctrlKey)) return false;
  if (alt !== e.altKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'Delete') return !mod && (e.key === 'Delete' || e.key === 'Backspace');
  // Les touches de ponctuation changent avec Maj selon les claviers : on compare aussi le code physique.
  const codeMatch =
    (key === ']' && e.code === 'BracketRight') ||
    (key === '[' && e.code === 'BracketLeft') ||
    (key === '=' && (e.code === 'Equal' || e.key === '+')) ||
    (key === '-' && (e.code === 'Minus' || e.code === 'NumpadSubtract')) ||
    (key === '0' && (e.code === 'Digit0' || e.code === 'Numpad0')) ||
    (key === '1' && (e.code === 'Digit1' || e.code === 'Numpad1')) ||
    (key === 'Enter' && e.key === 'Enter');
  // `<` et `>` : touche distincte ou ponctuation avec Maj selon le clavier, Maj n'est pas exigée.
  if (shift !== e.shiftKey && !(key === '=' && e.key === '+') && !('<>'.includes(key) && e.key === key))
    return false;
  return codeMatch || k.toLowerCase() === key.toLowerCase();
}

/** Gestion globale du clavier. */
export function handleKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (ui.get().dialog || ui.get().updateOpen) return;
  // La Bibliothèque photo a ses propres touches ; seul son raccourci d'ouverture passe.
  if (ui.get().photoLibrary && !matches(e, commandShortcut('file.photoLibrary') ?? '')) return;
  if (isEditingText()) {
    // Le focus a quitté le texte édité (clic dans un panneau) : la touche termine l'édition.
    endTextEdit();
    if (e.key === 'Escape') return;
  }
  if (!e.ctrlKey && !e.metaKey && getController()?.moduleKey(e)) {
    e.preventDefault();
    return;
  }
  if (!e.ctrlKey && !e.metaKey && getController()?.paths.key(e)) {
    e.preventDefault();
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && getController()?.photo.key(e)) {
    e.preventDefault();
    return;
  }
  const persona = ui.get().persona;
  const all = allCommands();
  // Les raccourcis propres à la Persona passent d'abord, s'ils ont quelque chose à faire.
  for (const [id, cmd] of all) {
    const shortcut = commandShortcut(id);
    if (cmd.persona !== persona || !shortcut || !matches(e, shortcut)) continue;
    if (cmd.enabled && !cmd.enabled()) continue;
    e.preventDefault();
    runCommand(id);
    return;
  }
  for (const [id, cmd] of all) {
    if (cmd.persona) continue;
    const shortcut = commandShortcut(id);
    if (shortcut && matches(e, shortcut)) {
      e.preventDefault();
      runCommand(id);
      return;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (arrows[e.key] && editor.selection.length) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    A.nudge(arrows[e.key][0] * k, arrows[e.key][1] * k);
    return;
  }
  if ((e.key === 'Escape' || e.key === 'Enter') && ui.get().cropId) {
    ui.set({ cropId: null });
    return;
  }
  if (e.key === 'Escape' && ui.get().linkFrom) {
    ui.set({ linkFrom: null });
    return;
  }
  if (e.key === 'Escape') {
    editor.select([]);
    return;
  }
  if (e.key === 'Enter' && selType() === 'text') {
    e.preventDefault();
    beginTextEdit(editor.selection[0], false);
    return;
  }
  if (opacityKey(e)) {
    e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  const tools = toolKeysFor(persona)[key];
  if (tools && !e.shiftKey) {
    e.preventDefault();
    if (e.repeat) return;
    const current = ui.get().tool;
    const tool = toolForKey(tools, current);
    dropHeldView();
    held = tools.includes(current) ? null : { key, prev: current, used: false, released: false, view: null };
    const c = getController();
    if (held && c && (tool === 'hand' || tool === 'zoom')) {
      held.view = tool;
      c.setHeldView(tool);
    } else if (tool === 'image') void startPlaceImage();
    else setTool(tool);
  }
}
