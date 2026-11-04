import { lazy, Suspense, type ComponentType } from 'react';
import { ui, useUi } from '../store';
import { LoadErrorBoundary } from './LoadErrorBoundary';
// Chaque fenêtre a son module (dossier dialogs/). Les cinq premières, seules à charger des modules
// pas encore chargés à ce stade (langue de départ, brouillons, filtres, modèles, panneaux), restent
// dans cet ordre : c'est celui dans lequel ces modules s'évaluent au démarrage.
import { LanguageDialog } from './dialogs/LanguageDialog';
import { DraftDialog } from './dialogs/DraftDialog';
import { FilterDialog } from './dialogs/FilterDialog';
import { LiveFilterDialog } from './dialogs/LiveFilterDialog';
import { PathEntryDialog } from './dialogs/PathEntryDialog';
import { LayerCountDialog } from './dialogs/LayerCountDialog';
import { NewDialog } from './dialogs/NewDialog';
import { UpdateDialog } from './UpdateDialog';
import { TourDialog } from './TourDialog';
import { WhatsNewDialog } from './WhatsNewDialog';
import { BlendDialog } from './dialogs/BlendDialog';
import { CommandPalette } from './dialogs/CommandPalette';
import { RecolorDialog } from './dialogs/RecolorDialog';

/**
 * Les grosses fenêtres se chargent à la première ouverture (un morceau de code à part) : le
 * démarrage de l'éditeur n'embarque que celles dont il a besoin tout de suite.
 */
function lazyDialog<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const AnimationDialog = lazyDialog(() => import('./dialogs/AnimationDialog'), 'AnimationDialog');
const FusionDialog = lazyDialog(() => import('./dialogs/FusionDialog'), 'FusionDialog');
const PanoramaDialog = lazyDialog(() => import('./dialogs/PanoramaDialog'), 'PanoramaDialog');
const CompsDialog = lazyDialog(() => import('./dialogs/CompsDialog'), 'CompsDialog');
const PhotoExportDialog = lazyDialog(() => import('./dialogs/PhotoExportDialog'), 'PhotoExportDialog');
const RawDialog = lazyDialog(() => import('./dialogs/RawDialog'), 'RawDialog');
const ContentFillDialog = lazyDialog(() => import('./dialogs/ContentFillDialog'), 'ContentFillDialog');
const BlendRangesDialog = lazyDialog(() => import('./dialogs/BlendRangesDialog'), 'BlendRangesDialog');
const MeshWarpDialog = lazyDialog(() => import('./dialogs/MeshWarpDialog'), 'MeshWarpDialog');
const WorkspaceDialog = lazyDialog(() => import('./dialogs/WorkspaceDialog'), 'WorkspaceDialog');
const AboutDialog = lazyDialog(() => import('./dialogs/AboutDialog'), 'AboutDialog');
const BatchDialog = lazyDialog(() => import('./dialogs/BatchDialog'), 'BatchDialog');
const CanvasSizeDialog = lazyDialog(() => import('./dialogs/CanvasSizeDialog'), 'CanvasSizeDialog');
const DocumentDialog = lazyDialog(() => import('./dialogs/DocumentDialog'), 'DocumentDialog');
const ExportDialog = lazyDialog(() => import('./dialogs/ExportDialog'), 'ExportDialog');
const ImageSizeDialog = lazyDialog(() => import('./dialogs/ImageSizeDialog'), 'ImageSizeDialog');
const OffsetDialog = lazyDialog(() => import('./dialogs/OffsetDialog'), 'OffsetDialog');
const ResizeDialog = lazyDialog(() => import('./dialogs/ResizeDialog'), 'ResizeDialog');
const SelectionModifyDialog = lazyDialog(
  () => import('./dialogs/SelectionModifyDialog'),
  'SelectionModifyDialog',
);
const ShortcutsDialog = lazyDialog(() => import('./ShortcutsDialog'), 'ShortcutsDialog');
const PreferencesDialog = lazyDialog(() => import('./PreferencesDialog'), 'PreferencesDialog');
const AiAssistantDialog = lazyDialog(() => import('./dialogs/AiDialogs'), 'AiAssistantDialog');
const AiImageDialog = lazyDialog(() => import('./dialogs/AiDialogs'), 'AiImageDialog');
const HelpDialog = lazyDialog(() => import('./HelpDialog'), 'HelpDialog');
const ExtensionParamsDialog = lazyDialog(
  () => import('../extensions/ExtensionsDialog'),
  'ExtensionParamsDialog',
);
const ExtensionsDialog = lazyDialog(() => import('../extensions/ExtensionsDialog'), 'ExtensionsDialog');
const VectorizeDialog = lazyDialog(() => import('../smart/VectorizeDialog'), 'VectorizeDialog');
const SaveTemplateDialog = lazyDialog(() => import('./dialogs/SaveTemplateDialog'), 'SaveTemplateDialog');

// Cadre commun des fenêtres : les autres modules de l'éditeur continuent de l'importer d'ici.
export { Modal } from './dialogs/Modal';

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  return (
    <>
      {/* Une clé par fenêtre : changer de fenêtre efface un éventuel message d'erreur. */}
      <LoadErrorBoundary key={dialog ?? 'none'} onClose={() => ui.set({ dialog: null })}>
        <Suspense fallback={null}>
          <MainDialog />
        </Suspense>
      </LoadErrorBoundary>
      <UpdateDialog />
      <WhatsNewDialog />
      <TourDialog />
    </>
  );
}

function MainDialog() {
  const dialog = useUi((s) => s.dialog);
  if (dialog === 'new') return <NewDialog />;
  if (dialog === 'palette') return <CommandPalette />;
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'draft') return <DraftDialog />;
  if (dialog === 'language') return <LanguageDialog />;
  if (dialog === 'resize') return <ResizeDialog />;
  if (dialog === 'offset') return <OffsetDialog />;
  if (dialog === 'animation') return <AnimationDialog />;
  if (dialog === 'fusion') return <FusionDialog />;
  if (dialog === 'panorama') return <PanoramaDialog />;
  if (dialog === 'document') return <DocumentDialog />;
  if (dialog === 'batch') return <BatchDialog />;
  if (dialog === 'filter') return <FilterDialog />;
  if (dialog === 'liveFilter') return <LiveFilterDialog />;
  if (dialog === 'raw') return <RawDialog />;
  if (dialog === 'photoExport') return <PhotoExportDialog />;
  if (dialog === 'comps') return <CompsDialog />;
  if (dialog === 'pathEntry') return <PathEntryDialog />;
  if (dialog === 'layerCount') return <LayerCountDialog />;
  if (dialog === 'blend') return <BlendDialog />;
  if (dialog === 'recolor') return <RecolorDialog />;
  if (dialog === 'contentFill') return <ContentFillDialog />;
  if (dialog === 'blendRanges') return <BlendRangesDialog />;
  if (dialog === 'meshWarp') return <MeshWarpDialog />;
  if (dialog === 'selectionModify') return <SelectionModifyDialog />;
  if (dialog === 'vectorize') return <VectorizeDialog />;
  if (dialog === 'extensions') return <ExtensionsDialog />;
  if (dialog === 'extensionParams') return <ExtensionParamsDialog />;
  if (dialog === 'imageSize') return <ImageSizeDialog />;
  if (dialog === 'canvasSize') return <CanvasSizeDialog />;
  if (dialog === 'workspace') return <WorkspaceDialog />;
  if (dialog === 'preferences') return <PreferencesDialog />;
  if (dialog === 'ai') return <AiAssistantDialog />;
  if (dialog === 'aiImage') return <AiImageDialog />;
  if (dialog === 'help') return <HelpDialog />;
  if (dialog === 'saveTemplate') return <SaveTemplateDialog />;
  return null;
}
