import { useUi } from '../store';
// Chaque fenêtre a son module (dossier dialogs/). Les cinq premières, seules à charger des modules
// pas encore chargés à ce stade (langue de départ, brouillons, filtres, modèles, panneaux), restent
// dans cet ordre : c'est celui dans lequel ces modules s'évaluent au démarrage.
import { LanguageDialog } from './dialogs/LanguageDialog';
import { DraftDialog } from './dialogs/DraftDialog';
import { FilterDialog } from './dialogs/FilterDialog';
import { LiveFilterDialog } from './dialogs/LiveFilterDialog';
import { NewDialog } from './dialogs/NewDialog';
import { WorkspaceDialog } from './dialogs/WorkspaceDialog';
import { AboutDialog } from './dialogs/AboutDialog';
import { BatchDialog } from './dialogs/BatchDialog';
import { CanvasSizeDialog } from './dialogs/CanvasSizeDialog';
import { DocumentDialog } from './dialogs/DocumentDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import { ImageSizeDialog } from './dialogs/ImageSizeDialog';
import { OffsetDialog } from './dialogs/OffsetDialog';
import { ResizeDialog } from './dialogs/ResizeDialog';
import { SelectionModifyDialog } from './dialogs/SelectionModifyDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { UpdateDialog } from './UpdateDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { AiAssistantDialog, AiImageDialog } from './dialogs/AiDialogs';
import { HelpDialog } from './HelpDialog';
import { ExtensionParamsDialog, ExtensionsDialog } from '../extensions/ExtensionsDialog';
import { VectorizeDialog } from '../smart/VectorizeDialog';
import { SaveTemplateDialog } from './dialogs/SaveTemplateDialog';

// Cadre commun des fenêtres : les autres modules de l'éditeur continuent de l'importer d'ici.
export { Modal } from './dialogs/Modal';

export function Dialogs() {
  return (
    <>
      <MainDialog />
      <UpdateDialog />
    </>
  );
}

function MainDialog() {
  const dialog = useUi((s) => s.dialog);
  if (dialog === 'new') return <NewDialog />;
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'draft') return <DraftDialog />;
  if (dialog === 'language') return <LanguageDialog />;
  if (dialog === 'resize') return <ResizeDialog />;
  if (dialog === 'offset') return <OffsetDialog />;
  if (dialog === 'document') return <DocumentDialog />;
  if (dialog === 'batch') return <BatchDialog />;
  if (dialog === 'filter') return <FilterDialog />;
  if (dialog === 'liveFilter') return <LiveFilterDialog />;
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
