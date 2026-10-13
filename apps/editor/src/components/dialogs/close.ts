import { ui } from '../../store';

/** Ferme la fenêtre ouverte : une seule fonction, commune aux fenêtres de ce dossier. */
export const close = () => ui.set({ dialog: null });
