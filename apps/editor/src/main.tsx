import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getController } from './components/Viewport';
import { startDrafts } from './drafts';
import { chooseStartLanguage } from './startLanguage';
import { startRustEngine } from './engine';
import { loadSystemFonts } from './fonts';
import { getLang } from './i18n';
import { isDesktop, openPath, openPhotoBytes } from './io';
import * as library from './libraryActions';
import * as vector from './vectorActions';
import * as symbols from './symbolActions';
import * as layout from './layoutActions';
import * as photo from './photo/photoActions';
import * as pixelSelection from './photo/selection';
import * as retouch from './photo/retouchActions';
import { normalizeTexts } from './normalize';
import * as prefs from './preferences';
import { artboardToSvg } from '@poulpe/core';
import { getPerformanceSettings, renderStats, setPerformanceSettings } from './perf';
import { editor, ui } from './store';
import './styles.css';

document.documentElement.lang = getLang();

// La taille des textes dépend des polices : elle est recalculée après chaque modification.
editor.setNormalizer(normalizeTexts);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

prefs.startPreferences();
void startRustEngine();
void loadSystemFonts();
// La langue d'abord (installeur ou premier lancement), puis le brouillon ou l'écran d'accueil.
void chooseStartLanguage().then(startDrafts);
void import('./updater').then((u) => u.startUpdateChecks());
void import('./extensions/host').then((x) => x.startExtensions());
if (isDesktop() || location.search.includes('bench'))
  void import('./bench').then((b) => b.maybeRunBenchmark(isDesktop()));

if (isDesktop()) {
  // Fichier passé au lancement (double-clic sur un .poulpe) ou ouvert pendant que l'appli tourne.
  import('@tauri-apps/api/core').then(async ({ invoke }) => {
    const path = await invoke<string | null>('opened_file').catch(() => null);
    if (path) await openPath(path);
  });
  import('@tauri-apps/api/event').then(({ listen }) => {
    void listen<string>('open-file', (e) => void openPath(e.payload));
  });
}

// Accès pour les tests de bout en bout.
(window as unknown as { poulpe: unknown }).poulpe = {
  editor,
  ui,
  library,
  vector,
  symbols,
  layout,
  core: { artboardToSvg },
  controller: getController,
  perf: { setPerformanceSettings, getPerformanceSettings, renderStats },
  engine: { start: startRustEngine },
  loadBenchDocument: (count: number) => import('./bench').then((b) => editor.load(b.benchDocument(count))),
  photo: { ...photo, ...pixelSelection, ...retouch, openPhotoBytes },
  prefs,
};
