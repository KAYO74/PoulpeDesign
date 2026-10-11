import { useEffect } from 'react';
import { baseName, isDesktop } from './io';
import { handleKeyDown, handleKeyUp } from './commands';
import { ContextBar } from './components/ContextBar';
import { Dialogs } from './components/Dialogs';
import { MenuBar } from './components/MenuBar';
import { StatusBar } from './components/StatusBar';
import { ToolColumn } from './components/ToolColumn';
import { Toolbar } from './components/Toolbar';
import { Viewport } from './components/Viewport';
import { useT } from './i18n';
import { Library } from './panels/Library';
import { PagesPanel } from './panels/PagesPanel';
import { Studio } from './panels/Studio';
import { DEFAULT_PANELS, PANEL_LIMITS, panels, startSplitter, usePanels } from './panels/panelLayout';
import { editor, useEditor, useUi } from './store';

export function App() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const filePath = useUi((s) => s.filePath);
  const persona = useUi((s) => s.persona);
  const { doc, dirty } = useEditor();
  const libraryW = usePanels((s) => s.libraryW);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const name = filePath ? baseName(filePath) : doc.name;
  return (
    <div className={`app tools-${settings.toolsSide} studio-${settings.studioSide} persona-${persona}`}>
      <header className="titlebar">
        <img className="appicon" src="./poulpe.svg" alt="" />
        <MenuBar />
        <div className="wtitle">
          <b>{t('app.name')}</b> — {name}
          {dirty ? ' •' : ''}
        </div>
      </header>
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
      </main>
      <StatusBar />
      <Dialogs />
    </div>
  );
}
