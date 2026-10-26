import type { Update } from '@tauri-apps/plugin-updater';
import { t } from './i18n';
import { confirmQuit } from './docTabs';
import { isDesktop } from './io';
import { toast, ui } from './store';

/*
 * Mises à jour automatiques de l'appli de bureau : au lancement (si l'option est active) et
 * depuis Aide > Rechercher les mises à jour. Les mises à jour sont publiées avec les versions
 * GitHub et signées : l'appli refuse un fichier dont la signature ne correspond pas à la clé
 * publique inscrite dans tauri.conf.json. La version navigateur est toujours à jour.
 */

export interface PendingUpdate {
  version: string;
  current: string;
  notes?: string;
  date?: string;
}

let update: Update | null = null;
let info: PendingUpdate | null = null;

export function pendingUpdate(): PendingUpdate | null {
  return info;
}

/** Cherche une mise à jour ; `silent` : ne dit rien s'il n'y en a pas ou en cas d'erreur. */
export async function checkForUpdates(silent = false): Promise<void> {
  if (!isDesktop()) {
    if (!silent) toast(t('update.web'));
    return;
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const found = await check({ timeout: 20_000 });
    if (!found) {
      if (!silent) toast(t('update.none', { version: __APP_VERSION__ }));
      return;
    }
    update = found;
    offerUpdate({
      version: found.version,
      current: found.currentVersion,
      notes: found.body,
      date: found.date,
    });
  } catch (e) {
    console.warn('Mises à jour :', e);
    if (!silent) toast(t('update.error'));
  }
}

/**
 * Propose la nouvelle version dans une petite fenêtre au centre, même si une autre fenêtre
 * (écran d'accueil, brouillon…) est ouverte : elle passe par-dessus.
 */
export function offerUpdate(found: PendingUpdate): void {
  info = found;
  ui.set({ updateOpen: true });
}

/** Télécharge et installe la mise à jour trouvée, puis redémarre Poulpe. */
export async function installUpdate(onProgress: (f: number | null) => void): Promise<void> {
  if (!update || !confirmQuit()) return;
  let total = 0,
    done = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') total = e.data.contentLength ?? 0;
    else if (e.event === 'Progress') {
      done += e.data.chunkLength;
      onProgress(total ? done / total : null);
    }
  });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** Au lancement de l'appli de bureau : vérification discrète, si l'option est active. */
export function startUpdateChecks(): void {
  if (!isDesktop() || !ui.get().settings.autoUpdate) return;
  // Juste après le démarrage, sans ralentir l'ouverture de la fenêtre.
  setTimeout(() => void checkForUpdates(true), 1500);
}
