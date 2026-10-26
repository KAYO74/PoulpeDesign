import { COLOR_ADJUSTMENTS, FORMAT_PRESETS, LIVE_FILTERS, LUT_PRESETS, type LutPreset } from '@poulpe/core';
import { addArtboard } from '../actions';
import { allCommands } from '../commands';
import { exportDocument } from '../io';
import { t } from '../i18n';
import { editor, setSettings, ui } from '../store';
import { STUDIO_TABS, isTabShown, tabsKind, toggleTab } from '../panels/studioTabs';
import { pixelStore } from '../tools/pixel/store';
import { activeWorkspace, applyWorkspace, workspaces } from '../workspaces';

/*
 * Contenu des menus (Fichier, Édition, Calque…), décrit une seule fois : la barre de menus de
 * l'éditeur l'affiche, et sur Mac l'appli de bureau en fait la barre de menus du système.
 */

export type MenuNode =
  /** Une commande : nom, raccourci et état actif viennent du registre des commandes. */
  | { kind: 'cmd'; id: string; checked?: boolean }
  | { kind: 'sep' }
  | { kind: 'sub'; label: string; items: MenuNode[] }
  /** Un choix propre au menu (format d'export, côté des outils…), avec une note à droite. */
  | {
      kind: 'action';
      key: string;
      label: string;
      run: () => void;
      checked?: boolean;
      hint?: string;
      testId?: string;
    };

export interface TopMenu {
  id: string;
  label: string;
  items: MenuNode[];
}

const cmd = (id: string, checked?: boolean): MenuNode => ({ kind: 'cmd', id, checked });
const sep: MenuNode = { kind: 'sep' };
const sub = (label: string, items: MenuNode[]): MenuNode => ({ kind: 'sub', label, items });

/** Retire les séparateurs en tête, en fin et doublés (éléments masqués). */
function tidy(items: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const n of items) {
    if (n.kind === 'sep' && (out.length === 0 || out[out.length - 1].kind === 'sep')) continue;
    out.push(n);
  }
  while (out.length && out[out.length - 1].kind === 'sep') out.pop();
  return out;
}

/** Espaces de travail personnalisés (menu Affichage et barre d'outils). */
export function workspaceNodes(): MenuNode[] {
  const list = workspaces.get().list;
  const active = activeWorkspace();
  return [
    ...list.map((w): MenuNode => ({
      kind: 'action',
      key: `workspace-${w.id}`,
      label: w.name,
      run: () => applyWorkspace(w.id),
      checked: active?.id === w.id,
      hint: t(`workspace.base.${w.base}`),
      testId: `workspace-${w.name}`,
    })),
    ...(list.length > 0 ? [sep] : []),
    {
      kind: 'action',
      key: 'workspace-new',
      label: t('workspace.new'),
      run: () => ui.set({ dialog: 'workspace', workspaceEdit: null }),
      testId: 'workspace-new',
    },
    ...(active
      ? [
          {
            kind: 'action',
            key: 'workspace-edit',
            label: t('workspace.edit', { name: active.name }),
            run: () => ui.set({ dialog: 'workspace', workspaceEdit: active.id }),
            testId: 'workspace-edit',
          } as MenuNode,
        ]
      : []),
  ];
}

function quickExport(kind: 'png' | 'jpeg' | 'svg' | 'pdf'): void {
  void exportDocument({
    kind,
    artboardId: kind === 'pdf' ? 'all' : editor.getState().activeArtboardId,
    scale: 1,
    quality: 0.92,
    transparent: false,
  });
}

/**
 * Les menus de l'appli. `nativeMac` : barre de menus du Mac, où Préférences passe dans le menu de
 * l'appli (à côté de la pomme), comme le veut l'usage sur Mac.
 */
export function menuSpec(opts: { nativeMac?: boolean } = {}): TopMenu[] {
  const { settings, persona, softProof } = ui.get();
  const quickMask = pixelStore.get().quickMask;
  const custom = activeWorkspace();
  const choice = (
    key: string,
    label: string,
    checked: boolean,
    run: () => void,
    testId?: string,
  ): MenuNode => ({
    kind: 'action',
    key,
    label,
    checked,
    run,
    testId,
  });
  const ext = allCommands().filter(([id]) => id.startsWith('ext:'));
  const macros = allCommands().filter(([id]) => id.startsWith('macro:'));
  const menus: TopMenu[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        cmd('file.new'),
        cmd('file.open'),
        cmd('file.openPhoto'),
        sep,
        cmd('file.save'),
        cmd('file.saveAs'),
        cmd('file.saveAsPsd'),
        cmd('file.saveTemplate'),
        sep,
        cmd('file.importImage'),
        cmd('file.placeLinked'),
        sep,
        cmd('file.export'),
        cmd('file.batchExport'),
        sub(
          t('file.export'),
          (['png', 'jpeg', 'svg', 'pdf'] as const).map((k) => ({
            kind: 'action',
            key: `export-${k}`,
            label: t(
              `file.export${k === 'png' ? 'Png' : k === 'jpeg' ? 'Jpeg' : k === 'svg' ? 'Svg' : 'Pdf'}`,
            ),
            run: () => quickExport(k),
          })),
        ),
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        cmd('edit.undo'),
        cmd('edit.redo'),
        sep,
        cmd('edit.cut'),
        cmd('edit.copy'),
        cmd('edit.paste'),
        cmd('edit.duplicate'),
        cmd('edit.delete'),
        sep,
        cmd('edit.selectAll'),
        cmd('edit.deselect'),
        sep,
        cmd('edit.clearPixels'),
        cmd('edit.contentAwareFill'),
        sep,
        ...(opts.nativeMac ? [] : [cmd('app.preferences')]),
      ],
    },
    {
      id: 'layer',
      label: t('menu.layer'),
      items: [
        cmd('layer.newPixel'),
        cmd('layer.copyToLayer'),
        sub(t('menu.mask'), [
          cmd('layer.addMask'),
          cmd('layer.editMask'),
          cmd('layer.toggleMask'),
          cmd('layer.invertMask'),
          cmd('layer.removeMask'),
        ]),
        cmd('layer.rasterize'),
        sub(t('menu.smartObject'), [
          cmd('layer.replaceImage'),
          cmd('layer.embedImage'),
          cmd('layer.updateLinks'),
        ]),
        cmd('image.removeBackground'),
        cmd('image.vectorize'),
        cmd('layer.mergeSelected'),
        cmd('layer.mergeVisible'),
        sep,
        sub(t('menu.order'), [
          cmd('arrange.front'),
          cmd('arrange.forward'),
          cmd('arrange.backward'),
          cmd('arrange.back'),
          sep,
          cmd('layer.selectAbove'),
          cmd('layer.selectBelow'),
        ]),
        cmd('layer.group'),
        cmd('layer.ungroup'),
        cmd('layer.clip'),
        sep,
        sub(t('menu.geometry'), [
          cmd('geometry.unite'),
          cmd('geometry.subtract'),
          cmd('geometry.intersect'),
          cmd('geometry.exclude'),
          cmd('geometry.divide'),
        ]),
        sub(t('menu.symbols'), [
          cmd('symbol.create'),
          cmd('symbol.update'),
          cmd('symbol.detach'),
          sep,
          cmd('style.save'),
        ]),
        cmd('layer.convertToCurves'),
        cmd('layer.outlineStroke'),
        cmd('layer.offset'),
        sep,
        cmd('layer.lock'),
        cmd('layer.hide'),
      ],
    },
    {
      id: 'select',
      label: t('menu.select'),
      items: [
        cmd('select.all'),
        cmd('select.deselect'),
        cmd('select.invert'),
        sep,
        cmd('select.feather'),
        cmd('select.grow'),
        cmd('select.shrink'),
        sep,
        cmd('select.fromLayer'),
        cmd('select.subject'),
        sep,
        cmd('select.quickMask', quickMask),
      ],
    },
    {
      id: 'adjust',
      label: t('menu.adjust'),
      items: [
        ...COLOR_ADJUSTMENTS.map((k) => cmd(`adjust.${k}`)),
        sep,
        sub(
          t('menu.liveFilters'),
          LIVE_FILTERS.map((k) => cmd(`adjust.${k}`)),
        ),
        sub(t('menu.lut'), [
          ...(Object.keys(LUT_PRESETS) as LutPreset[]).map((k) => cmd(`lut.${k}`)),
          sep,
          cmd('lut.load'),
        ]),
        sep,
        cmd('adjust.auto'),
      ],
    },
    {
      id: 'filters',
      label: t('menu.filters'),
      items: [
        ...LIVE_FILTERS.map((k) => cmd(`filter.${k}`)),
        sep,
        sub(
          t('menu.adjust'),
          COLOR_ADJUSTMENTS.map((k) => cmd(`filter.${k}`)),
        ),
        sep,
        sub(t('menu.layerLiveFilters'), [
          ...LIVE_FILTERS.map((k) => cmd(`livefilter.${k}`)),
          sep,
          ...COLOR_ADJUSTMENTS.map((k) => cmd(`livefilter.${k}`)),
        ]),
        sep,
        cmd('edit.contentAwareFill'),
      ],
    },
    {
      id: 'text',
      label: t('menu.text'),
      items: [
        sub(t('text.format'), [
          cmd('text.bold'),
          cmd('text.italic'),
          cmd('text.underline'),
          sep,
          cmd('text.biggerFont'),
          cmd('text.smallerFont'),
          sep,
          cmd('text.alignLeft'),
          cmd('text.alignCenter'),
          cmd('text.alignRight'),
          cmd('text.justify'),
        ]),
        sep,
        cmd('text.onPath'),
        cmd('text.offPath'),
        sep,
        cmd('text.toCurves'),
        sep,
        cmd('text.frame'),
        cmd('text.link'),
        cmd('text.unlink'),
        sep,
        cmd('text.pageNumber'),
      ],
    },
    {
      id: 'arrange',
      label: t('menu.arrange'),
      items: [
        cmd('arrange.front'),
        cmd('arrange.forward'),
        cmd('arrange.backward'),
        cmd('arrange.back'),
        sep,
        cmd('arrange.alignLeft'),
        cmd('arrange.alignHCenter'),
        cmd('arrange.alignRight'),
        cmd('arrange.alignTop'),
        cmd('arrange.alignVCenter'),
        cmd('arrange.alignBottom'),
        sep,
        cmd('arrange.distributeH'),
        cmd('arrange.distributeV'),
        sep,
        cmd('arrange.flipH'),
        cmd('arrange.flipV'),
        cmd('arrange.rotateLeft'),
        cmd('arrange.rotateRight'),
      ],
    },
    {
      id: 'document',
      label: t('menu.document'),
      items: [
        cmd('document.addArtboard'),
        sub(
          t('studio.formats'),
          FORMAT_PRESETS.map((f) => ({
            kind: 'action',
            key: `format-${f.id}`,
            label: t(`format.${f.id}`),
            hint: `${f.width} × ${f.height}`,
            run: () => addArtboard(f.width, f.height),
          })),
        ),
        cmd('document.deleteArtboard'),
        sep,
        cmd('pages.add'),
        cmd('pages.duplicate'),
        cmd('pages.delete'),
        cmd('pages.addMaster'),
        cmd('pages.arrange'),
        sep,
        cmd('document.resize'),
        cmd('document.imageSize'),
        cmd('document.canvasSize'),
        cmd('document.setup'),
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        cmd('persona.draw', !custom && persona === 'draw'),
        cmd('persona.photo', !custom && persona === 'photo'),
        cmd('persona.layout', !custom && persona === 'layout'),
        sub(t('workspace.menu'), workspaceNodes()),
        sep,
        cmd('view.zoomIn'),
        cmd('view.zoomOut'),
        cmd('view.zoomFit'),
        cmd('view.zoom100'),
        sep,
        cmd('view.library', settings.library),
        cmd('view.rulers', settings.rulers),
        cmd('view.clearGuides'),
        cmd('view.grid', settings.grid),
        cmd('view.softProof', softProof),
        cmd('view.snapping', settings.snapping),
        sep,
        sub(t('view.toolsSide'), [
          ...(['left', 'right'] as const).map((side) =>
            choice(
              `tools-${side}`,
              t(side === 'left' ? 'view.left' : 'view.right'),
              settings.toolsSide === side,
              () => setSettings({ toolsSide: side }),
            ),
          ),
          sep,
          ...(['auto', 'one', 'two'] as const).map((c) =>
            choice(
              `tools-columns-${c}`,
              t(`view.toolsColumns.${c}`),
              settings.toolsColumns === c,
              () => setSettings({ toolsColumns: c }),
              `menu-tools-columns-${c}`,
            ),
          ),
          sep,
          ...(['all', 'groups'] as const).map((l) =>
            choice(
              `tools-layout-${l}`,
              t(`view.toolsLayout.${l}`),
              settings.toolsLayout === l,
              () => setSettings({ toolsLayout: l }),
              `menu-tools-layout-${l}`,
            ),
          ),
          sep,
          choice(
            'tools-lock',
            t('view.toolsLocked'),
            settings.toolsLocked,
            () => setSettings({ toolsLocked: !ui.get().settings.toolsLocked }),
            'menu-tools-lock',
          ),
        ]),
        sub(
          t('view.studioSide'),
          (['left', 'right'] as const).map((side) =>
            choice(
              `studio-${side}`,
              t(side === 'left' ? 'view.left' : 'view.right'),
              settings.studioSide === side,
              () => setSettings({ studioSide: side }),
            ),
          ),
        ),
        cmd('view.colorPicker'),
        cmd('view.brushEditor'),
        cmd('view.resetPanels'),
      ],
    },
    {
      // Comme le menu Fenêtre de Photoshop et d'Affinity : afficher ou fermer chaque panneau.
      id: 'window',
      label: t('menu.window'),
      items: [
        ...STUDIO_TABS.map((tab) =>
          choice(
            `panel-${tab.id}`,
            t(tab.label),
            isTabShown(tabsKind(persona), tab.id),
            () => toggleTab(tabsKind(ui.get().persona), tab.id),
            `menu-panel-${tab.id}`,
          ),
        ),
        sep,
        cmd('view.library', settings.library),
        cmd('view.colorPicker'),
        cmd('view.brushEditor'),
        sep,
        cmd('view.resetPanels'),
      ],
    },
    {
      id: 'ai',
      label: t('menu.ai'),
      items: [cmd('ai.assistant'), cmd('ai.image'), sep, cmd('ai.settings')],
    },
    {
      id: 'extensions',
      label: t('menu.extensions'),
      items: [
        ...ext.map(([id]) => cmd(id)),
        sep,
        cmd('extensions.manage'),
        sep,
        cmd('macro.record'),
        ...(macros.length > 0
          ? [
              sub(
                t('macro.title'),
                macros.map(([id]) => cmd(id)),
              ),
            ]
          : []),
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        cmd('help.docs'),
        cmd('help.faq'),
        cmd('help.shortcuts'),
        sep,
        cmd('help.settings'),
        cmd('help.checkUpdates'),
        ...(opts.nativeMac ? [] : [sep, cmd('help.about')]),
      ],
    },
  ];
  const clean = (items: MenuNode[]): MenuNode[] =>
    tidy(items).map((n) => (n.kind === 'sub' ? { ...n, items: clean(n.items) } : n));
  return menus.map((m) => ({ ...m, items: clean(m.items) }));
}
