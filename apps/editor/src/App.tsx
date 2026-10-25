import { useEffect } from 'react';
import { baseName, isDesktop } from './io';
import { dropFiles, hasFiles } from './dropFiles';
import { handleKeyDown, handleKeyUp, isMac } from './commands';
import { ContextBar } from './components/ContextBar';
import { Dialogs } from './components/Dialogs';
import { MenuBar } from './components/MenuBar';
import { StatusBar } from './components/StatusBar';
import { ToolColumn } from './components/ToolColumn';
import { ColorWindow } from './panels/ColorWindow';
import { BrushEditor } from './tools/brushes/BrushEditor';
import { Toolbar } from './components/Toolbar';
import { Viewport } from './components/Viewport';
import { WindowControls } from './components/WindowControls';
import { useT } from './i18n';
import { Library } from './panels/Library';
import { PagesPanel } from './panels/PagesPanel';
import { Studio } from './panels/Studio';
import { DEFAULT_PANELS, PANEL_LIMITS, panels, startSplitter, usePanels } from './panels/panelLayout';
import { editor, ui, useEditor, useUi } from './store';
import { applyAccent } from './accentColor';
import { applyUiScale } from './uiScale';

/*
 * Appli de bureau : sur Mac, les menus vont dans la barre du haut de l'écran (nativeMenu.ts) ;
 * sous Windows et Linux, la barre de titre de l'éditeur remplace celle du système.
 */
const nativeMenus = isDesktop() && isMac;
const ownTitleBar = isDesktop() && !isMac;

export function App() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const filePath = useUi((s) => s.filePath);
  const persona = useUi((s) => s.persona);
  const { doc, dirty } = useEditor();
  const libraryW = usePanels((s) => s.libraryW);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    applyAccent(settings.accent, settings.theme);
  }, [settings.theme, settings.accent]);

  useEffect(() => {
    void applyUiScale(settings.uiScale);
  }, [settings.uiScale]);

  useEffect(() => {
    const name = filePath ? baseName(filePath) : doc.name;
    document.title = `${dirty ? '• ' : ''}${name} — Poulpe Design`;
    if (isDesktop()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(document.title))
        .catch(() => {});
    }
  }, [doc.name, filePath, dirty]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDesktop() && editor.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    // Fichiers lâchés hors de la zone de travail (écran d'accueil, panneaux) : sans cela,
    // la fenêtre afficherait le fichier à la place de l'éditeur.
    const dragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const dialog = ui.get().dialog;
      if (!dialog || dialog === 'new') void dropFiles([...e.dataTransfer!.files]);
    };
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const name = filePath ? baseName(filePath) : doc.name;
  return (
    <div
      className={`app${nativeMenus ? ' native-menus' : ''} tools-${settings.toolsSide} studio-${settings.studioSide} persona-${persona}`}
    >
      {!nativeMenus && (
        <header
          className={`titlebar${ownTitleBar ? ' own' : ''}`}
          data-tauri-drag-region={ownTitleBar || undefined}
        >
          <img
            className="appicon"
            src="./poulpe.png"
            alt=""
            data-tauri-drag-region={ownTitleBar || undefined}
          />
          <MenuBar />
          <div className="wtitle" data-tauri-drag-region={ownTitleBar || undefined}>
            <b data-tauri-drag-region={ownTitleBar || undefined}>{t('app.name')}</b> — {name}
            {dirty ? ' •' : ''}
          </div>
          {ownTitleBar && <WindowControls />}
        </header>
      )}
      <Toolbar />
      <ContextBar />
      <main className="workspace">
        <ToolColumn />
        {(persona === 'layout' || settings.library) && (
          <div className="library-dock" style={{ width: libraryW }}>
            {persona === 'layout' ? <PagesPanel /> : <Library />}
            <div
              className={`split-h ${settings.studioSide === 'right' ? 'at-right' : 'at-left'}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('panel.resize')}
              data-testid="library-resize"
              onPointerDown={(e) =>
                startSplitter(
                  e,
                  'libraryW',
                  settings.studioSide === 'right' ? 1 : -1,
                  [...PANEL_LIMITS.libraryW],
                  libraryW,
                )
              }
              onDoubleClick={() => panels.set({ libraryW: DEFAULT_PANELS.libraryW })}
            />
          </div>
        )}
        <div className="doc-area">
          <div className="doc-tabs" role="tablist">
            <span className="doc-tab" role="tab" aria-selected="true">
              {dirty && <span className="dot" aria-hidden="true" />}
              {name}.poulpe
            </span>
          </div>
          <Viewport />
        </div>
        <Studio />
        <ColorWindow />
        <BrushEditor />
      </main>
      <StatusBar />
      <Dialogs />
    </div>
  );
}
