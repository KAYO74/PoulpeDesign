import * as Menu from '@radix-ui/react-dropdown-menu';
import { COLOR_ADJUSTMENTS, FORMAT_PRESETS, LIVE_FILTERS, LUT_PRESETS, type LutPreset } from '@poulpe/core';
import { addArtboard } from '../actions';
import { useSyncExternalStore } from 'react';
import {
  allCommands,
  commandShortcut,
  commandTitle,
  commandsVersion,
  findCommand,
  formatShortcut,
  runCommand,
  subscribeCommands,
  type CommandId,
} from '../commands';
import { useShortcuts } from '../shortcuts';
import { exportDocument } from '../io';
import { useT } from '../i18n';
import { setSettings, useEditor, useStore, useUi } from '../store';
import { pixelStore } from '../tools/pixel/store';
import { Icon } from './Icon';
import { WorkspaceItems } from './WorkspaceMenu';
import { useActiveWorkspace } from '../workspaces';

export function Item({ id, checked }: { id: CommandId | (string & {}); checked?: boolean }) {
  useT();
  useShortcuts();
  const cmd = findCommand(id);
  if (!cmd) return null;
  const enabled = !cmd.enabled || cmd.enabled();
  const shortcut = commandShortcut(id);
  return (
    <Menu.Item className="menu-item" disabled={!enabled} onSelect={() => void runCommand(id)}>
      <span className="menu-check">{checked ? '✓' : ''}</span>
      <span className="menu-label">{commandTitle(cmd)}</span>
      {shortcut && <span className="menu-shortcut">{formatShortcut(shortcut)}</span>}
    </Menu.Item>
  );
}

function Top({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="menubar-trigger">{label}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={2}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export const Sep = () => <Menu.Separator className="menu-sep" />;

/** Menu Extensions : les commandes des extensions installées, puis la gestion. */
function ExtensionsMenu() {
  const t = useT();
  useSyncExternalStore(subscribeCommands, commandsVersion);
  const ext = allCommands().filter(([id]) => id.startsWith('ext:'));
  const macros = allCommands().filter(([id]) => id.startsWith('macro:'));
  return (
    <Top label={t('menu.extensions')}>
      {ext.map(([id]) => (
        <Item key={id} id={id} />
      ))}
      {ext.length > 0 && <Sep />}
      <Item id="extensions.manage" />
      <Sep />
      <Item id="macro.record" />
      {macros.length > 0 && (
        <Sub label={t('macro.title')}>
          {macros.map(([id]) => (
            <Item key={id} id={id} />
          ))}
        </Sub>
      )}
    </Top>
  );
}

export function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className="menu-item">
        <span className="menu-check" />
        <span className="menu-label">{label}</span>
        <Icon name="chevron" size={12} />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className="menu" sideOffset={4}>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

export function MenuBar() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const persona = useUi((s) => s.persona);
  const custom = useActiveWorkspace();
  const softProof = useUi((s) => s.softProof);
  const quickMask = useStore(pixelStore, (s) => s.quickMask);
  const { activeArtboardId } = useEditor();
  const quickExport = (kind: 'png' | 'jpeg' | 'svg' | 'pdf') =>
    void exportDocument({
      kind,
      artboardId: kind === 'pdf' ? 'all' : activeArtboardId,
      scale: 1,
      quality: 0.92,
      transparent: false,
    });
  return (
    <nav className="menubar" aria-label="Menu">
      <Top label={t('menu.file')}>
        <Item id="file.new" />
        <Item id="file.open" />
        <Item id="file.openPhoto" />
        <Sep />
        <Item id="file.save" />
        <Item id="file.saveAs" />
        <Item id="file.saveTemplate" />
        <Sep />
        <Item id="file.importImage" />
        <Sep />
        <Item id="file.export" />
        <Item id="file.batchExport" />
        <Sub label={t('file.export')}>
          {(['png', 'jpeg', 'svg', 'pdf'] as const).map((k) => (
            <Menu.Item key={k} className="menu-item" onSelect={() => quickExport(k)}>
              <span className="menu-check" />
              <span className="menu-label">
                {t(`file.export${k === 'png' ? 'Png' : k === 'jpeg' ? 'Jpeg' : k === 'svg' ? 'Svg' : 'Pdf'}`)}
              </span>
            </Menu.Item>
          ))}
        </Sub>
      </Top>
      <Top label={t('menu.edit')}>
        <Item id="edit.undo" />
        <Item id="edit.redo" />
        <Sep />
        <Item id="edit.cut" />
        <Item id="edit.copy" />
        <Item id="edit.paste" />
        <Item id="edit.duplicate" />
        <Item id="edit.delete" />
        <Sep />
        <Item id="edit.selectAll" />
        <Item id="edit.deselect" />
        <Sep />
        <Item id="edit.clearPixels" />
        <Item id="edit.contentAwareFill" />
        <Sep />
        <Item id="app.preferences" />
      </Top>
      <Top label={t('menu.layer')}>
        <Item id="layer.newPixel" />
        <Item id="layer.copyToLayer" />
        <Sub label={t('menu.mask')}>
          <Item id="layer.addMask" />
          <Item id="layer.editMask" />
          <Item id="layer.toggleMask" />
          <Item id="layer.invertMask" />
          <Item id="layer.removeMask" />
        </Sub>
        <Item id="layer.rasterize" />
        <Item id="image.removeBackground" />
        <Item id="image.vectorize" />
        <Item id="layer.mergeVisible" />
        <Sep />
        <Sub label={t('menu.order')}>
          <Item id="arrange.front" />
          <Item id="arrange.forward" />
          <Item id="arrange.backward" />
          <Item id="arrange.back" />
          <Sep />
          <Item id="layer.selectAbove" />
          <Item id="layer.selectBelow" />
        </Sub>
        <Item id="layer.group" />
        <Item id="layer.ungroup" />
        <Item id="layer.clip" />
        <Sep />
        <Sub label={t('menu.geometry')}>
          <Item id="geometry.unite" />
          <Item id="geometry.subtract" />
          <Item id="geometry.intersect" />
          <Item id="geometry.exclude" />
          <Item id="geometry.divide" />
        </Sub>
        <Sub label={t('menu.symbols')}>
          <Item id="symbol.create" />
          <Item id="symbol.update" />
          <Item id="symbol.detach" />
          <Sep />
          <Item id="style.save" />
        </Sub>
        <Item id="layer.convertToCurves" />
        <Item id="layer.outlineStroke" />
        <Item id="layer.offset" />
        <Sep />
        <Item id="layer.lock" />
        <Item id="layer.hide" />
      </Top>
      <Top label={t('menu.select')}>
        <Item id="select.all" />
        <Item id="select.deselect" />
        <Item id="select.invert" />
        <Sep />
        <Item id="select.feather" />
        <Item id="select.grow" />
        <Item id="select.shrink" />
        <Sep />
        <Item id="select.fromLayer" />
        <Item id="select.subject" />
        <Sep />
        <Item id="select.quickMask" checked={quickMask} />
      </Top>
      <Top label={t('menu.adjust')}>
        {COLOR_ADJUSTMENTS.map((k) => (
          <Item key={k} id={`adjust.${k}`} />
        ))}
        <Sep />
        <Sub label={t('menu.liveFilters')}>
          {LIVE_FILTERS.map((k) => (
            <Item key={k} id={`adjust.${k}`} />
          ))}
        </Sub>
        <Sub label={t('menu.lut')}>
          {(Object.keys(LUT_PRESETS) as LutPreset[]).map((k) => (
            <Item key={k} id={`lut.${k}`} />
          ))}
          <Sep />
          <Item id="lut.load" />
        </Sub>
        <Sep />
        <Item id="adjust.auto" />
      </Top>
      <Top label={t('menu.filters')}>
        {LIVE_FILTERS.map((k) => (
          <Item key={k} id={`filter.${k}`} />
        ))}
        <Sep />
        <Sub label={t('menu.adjust')}>
          {COLOR_ADJUSTMENTS.map((k) => (
            <Item key={k} id={`filter.${k}`} />
          ))}
        </Sub>
        <Sep />
        <Item id="edit.contentAwareFill" />
      </Top>
      <Top label={t('menu.text')}>
        <Sub label={t('text.format')}>
          <Item id="text.bold" />
          <Item id="text.italic" />
          <Item id="text.underline" />
          <Sep />
          <Item id="text.biggerFont" />
          <Item id="text.smallerFont" />
          <Sep />
          <Item id="text.alignLeft" />
          <Item id="text.alignCenter" />
          <Item id="text.alignRight" />
          <Item id="text.justify" />
        </Sub>
        <Sep />
        <Item id="text.onPath" />
        <Item id="text.offPath" />
        <Sep />
        <Item id="text.toCurves" />
        <Sep />
        <Item id="text.frame" />
        <Item id="text.link" />
        <Item id="text.unlink" />
        <Sep />
        <Item id="text.pageNumber" />
      </Top>
      <Top label={t('menu.arrange')}>
        <Item id="arrange.front" />
        <Item id="arrange.forward" />
        <Item id="arrange.backward" />
        <Item id="arrange.back" />
        <Sep />
        <Item id="arrange.alignLeft" />
        <Item id="arrange.alignHCenter" />
        <Item id="arrange.alignRight" />
        <Item id="arrange.alignTop" />
        <Item id="arrange.alignVCenter" />
        <Item id="arrange.alignBottom" />
        <Sep />
        <Item id="arrange.distributeH" />
        <Item id="arrange.distributeV" />
        <Sep />
        <Item id="arrange.flipH" />
        <Item id="arrange.flipV" />
        <Item id="arrange.rotateLeft" />
        <Item id="arrange.rotateRight" />
      </Top>
      <Top label={t('menu.document')}>
        <Item id="document.addArtboard" />
        <Sub label={t('studio.formats')}>
          {FORMAT_PRESETS.map((f) => (
            <Menu.Item key={f.id} className="menu-item" onSelect={() => addArtboard(f.width, f.height)}>
              <span className="menu-check" />
              <span className="menu-label">{t(`format.${f.id}`)}</span>
              <span className="menu-shortcut">
                {f.width} × {f.height}
              </span>
            </Menu.Item>
          ))}
        </Sub>
        <Item id="document.deleteArtboard" />
        <Sep />
        <Item id="pages.add" />
        <Item id="pages.duplicate" />
        <Item id="pages.delete" />
        <Item id="pages.addMaster" />
        <Item id="pages.arrange" />
        <Sep />
        <Item id="document.resize" />
        <Item id="document.imageSize" />
        <Item id="document.canvasSize" />
        <Item id="document.setup" />
      </Top>
      <Top label={t('menu.view')}>
        <Item id="persona.draw" checked={!custom && persona === 'draw'} />
        <Item id="persona.photo" checked={!custom && persona === 'photo'} />
        <Item id="persona.layout" checked={!custom && persona === 'layout'} />
        <Sub label={t('workspace.menu')}>
          <WorkspaceItems />
        </Sub>
        <Sep />
        <Item id="view.zoomIn" />
        <Item id="view.zoomOut" />
        <Item id="view.zoomFit" />
        <Item id="view.zoom100" />
        <Sep />
        <Item id="view.library" checked={settings.library} />
        <Item id="view.rulers" checked={settings.rulers} />
        <Item id="view.clearGuides" />
        <Item id="view.grid" checked={settings.grid} />
        <Item id="view.softProof" checked={softProof} />
        <Item id="view.snapping" checked={settings.snapping} />
        <Sep />
        <Sub label={t('view.toolsSide')}>
          {(['left', 'right'] as const).map((side) => (
            <Menu.Item key={side} className="menu-item" onSelect={() => setSettings({ toolsSide: side })}>
              <span className="menu-check">{settings.toolsSide === side ? '✓' : ''}</span>
              <span className="menu-label">{t(side === 'left' ? 'view.left' : 'view.right')}</span>
            </Menu.Item>
          ))}
          <Sep />
          {(['auto', 'one', 'two'] as const).map((c) => (
            <Menu.Item
              key={c}
              className="menu-item"
              data-testid={`menu-tools-columns-${c}`}
              onSelect={() => setSettings({ toolsColumns: c })}
            >
              <span className="menu-check">{settings.toolsColumns === c ? '✓' : ''}</span>
              <span className="menu-label">{t(`view.toolsColumns.${c}`)}</span>
            </Menu.Item>
          ))}
          <Sep />
          {(['all', 'groups'] as const).map((l) => (
            <Menu.Item
              key={l}
              className="menu-item"
              data-testid={`menu-tools-layout-${l}`}
              onSelect={() => setSettings({ toolsLayout: l })}
            >
              <span className="menu-check">{settings.toolsLayout === l ? '✓' : ''}</span>
              <span className="menu-label">{t(`view.toolsLayout.${l}`)}</span>
            </Menu.Item>
          ))}
          <Sep />
          <Menu.Item
            className="menu-item"
            data-testid="menu-tools-lock"
            onSelect={() => setSettings({ toolsLocked: !settings.toolsLocked })}
          >
            <span className="menu-check">{settings.toolsLocked ? '✓' : ''}</span>
            <span className="menu-label">{t('view.toolsLocked')}</span>
          </Menu.Item>
        </Sub>
        <Sub label={t('view.studioSide')}>
          {(['left', 'right'] as const).map((side) => (
            <Menu.Item key={side} className="menu-item" onSelect={() => setSettings({ studioSide: side })}>
              <span className="menu-check">{settings.studioSide === side ? '✓' : ''}</span>
              <span className="menu-label">{t(side === 'left' ? 'view.left' : 'view.right')}</span>
            </Menu.Item>
          ))}
        </Sub>
        <Item id="view.resetPanels" />
      </Top>
      <ExtensionsMenu />
      <Top label={t('menu.help')}>
        <Item id="help.docs" />
        <Item id="help.faq" />
        <Item id="help.shortcuts" />
        <Sep />
        <Item id="help.settings" />
        <Item id="help.checkUpdates" />
        <Sep />
        <Item id="help.about" />
      </Top>
    </nav>
  );
}
