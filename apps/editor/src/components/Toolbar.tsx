import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMMANDS, commandShortcut, formatShortcut, runCommand, type CommandId } from '../commands';
import { useT } from '../i18n';
import { setSettings, ui, useEditor, useUi, type Persona } from '../store';
import { openPersona, useActiveWorkspace } from '../workspaces';
import { WorkspaceMenu } from './WorkspaceMenu';
import { AdjustmentMenu } from './AdjustmentMenu';
import { Icon, type IconName } from './Icon';

function CmdButton({ id, icon }: { id: CommandId; icon: IconName }) {
  const t = useT();
  useEditor();
  const cmd = COMMANDS[id] as (typeof COMMANDS)[CommandId] & { enabled?: () => boolean; shortcut?: string };
  const shortcut = commandShortcut(id);
  const label = t(cmd.label) + (shortcut ? ` (${formatShortcut(shortcut)})` : '');
  const [tip, setTip] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const tipKey = `cmdtip.${id}`;
  const desc = t(tipKey as never);
  const leave = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };
  return (
    <button
      className="ib"
      aria-label={label}
      disabled={cmd.enabled ? !cmd.enabled() : false}
      onClick={() => {
        leave();
        void runCommand(id);
      }}
      onPointerEnter={(e) => {
        const el = e.currentTarget;
        timer.current = window.setTimeout(() => setTip(el.getBoundingClientRect()), 500);
      }}
      onPointerLeave={leave}
    >
      <Icon name={icon} />
      {tip &&
        createPortal(
          <div
            className="tool-tip cmd-tip"
            role="tooltip"
            style={{ top: tip.bottom + 8, left: Math.max(8, Math.min(tip.left, window.innerWidth - 268)) }}
          >
            <div className="tool-tip-title">
              {t(cmd.label)}
              {shortcut ? ` [${formatShortcut(shortcut)}]` : ''}
            </div>
            {desc !== tipKey && <p className="tool-tip-desc">{desc}</p>}
          </div>,
          document.body,
        )}
    </button>
  );
}

function Toggle({
  on,
  icon,
  label,
  onClick,
}: {
  on: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="ib" aria-pressed={on} title={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** Onglets en haut, comme Affinity : Photos, puis Vectoriel, Pixel, Mise en page, Export. */
const PERSONA_TABS: Persona[] = ['draw', 'photo', 'layout', 'export'];
const TAB_ICONS: Record<Persona, IconName> = {
  draw: 'tabDraw',
  photo: 'tabPhoto',
  layout: 'tabLayout',
  export: 'tabExport',
};

export function Toolbar() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const persona = useUi((s) => s.persona);
  const softProof = useUi((s) => s.softProof);
  const photo = persona === 'photo';
  const custom = useActiveWorkspace();
  const photoLibrary = useUi((s) => s.photoLibrary);
  return (
    <div className="toolbar" role="toolbar" aria-label="Barre d'outils">
      <div className="personas" role="group" aria-label="Personas">
        <button
          className="persona persona-tab"
          aria-pressed={photoLibrary}
          title={`${t('plib.open')} (${formatShortcut(commandShortcut('file.photoLibrary') ?? '')})`}
          aria-label={t('plib.open')}
          data-testid="persona-library"
          onClick={() => void runCommand('file.photoLibrary')}
        >
          <Icon name="photoLibrary" />
          <span className="persona-label">{t('tab.library')}</span>
        </button>
        {PERSONA_TABS.map((p) => (
          <button
            key={p}
            className="persona persona-tab"
            aria-pressed={!photoLibrary && !custom && persona === p}
            title={t(`persona.${p}`)}
            aria-label={t(`persona.${p}`)}
            data-testid={`persona-${p}`}
            onClick={() => openPersona(p)}
          >
            <Icon name={TAB_ICONS[p]} />
            <span className="persona-label">{t(`tab.${p}`)}</span>
          </button>
        ))}
        <WorkspaceMenu />
      </div>
      {persona === 'export' ? (
        <>
          <CmdButton id="slices.fromSelection" icon="pixelLayer" />
          <CmdButton id="slices.fromArtboards" icon="artboard" />
          <span className="tsep" />
          <CmdButton id="slices.export" icon="export" />
        </>
      ) : persona === 'layout' ? (
        <>
          <CmdButton id="pages.add" icon="pages" />
          <CmdButton id="pages.addMaster" icon="master" />
          <CmdButton id="document.setup" icon="settings" />
          <span className="tsep" />
          <CmdButton id="text.frame" icon="textFrame" />
          <CmdButton id="text.link" icon="link" />
          <CmdButton id="text.unlink" icon="unlink" />
          <CmdButton id="text.pageNumber" icon="pageNumber" />
          <span className="tsep" />
          <Toggle
            on={softProof}
            icon="proof"
            label={t('view.softProof')}
            onClick={() => ui.set({ softProof: !softProof })}
          />
        </>
      ) : (
        <Toggle
          on={settings.library}
          icon="library"
          label={t('view.library')}
          onClick={() => setSettings({ library: !settings.library })}
        />
      )}
      <span className="tsep" />
      <Toggle
        on={settings.snapping}
        icon="snap"
        label={t('view.snapping')}
        onClick={() => setSettings({ snapping: !settings.snapping })}
      />
      <Toggle
        on={settings.grid}
        icon="grid"
        label={t('view.grid')}
        onClick={() => setSettings({ grid: !settings.grid })}
      />
      <Toggle
        on={settings.rulers}
        icon="ruler"
        label={t('view.rulers')}
        onClick={() => setSettings({ rulers: !settings.rulers })}
      />
      <span className="tsep" />
      <CmdButton id="arrange.front" icon="front" />
      <CmdButton id="arrange.forward" icon="forward" />
      <CmdButton id="arrange.backward" icon="backward" />
      <CmdButton id="arrange.back" icon="back" />
      <span className="tsep" />
      <CmdButton id="layer.group" icon="group" />
      <CmdButton id="layer.ungroup" icon="ungroup" />
      <CmdButton id="layer.clip" icon="mask" />
      <span className="tsep" />
      {photo ? (
        <>
          <CmdButton id="layer.newPixel" icon="pixelLayer" />
          <CmdButton id="layer.addMask" icon="addMask" />
          <AdjustmentMenu />
          <span className="tsep" />
          <CmdButton id="select.deselect" icon="deselect" />
          <CmdButton id="select.invert" icon="invertSel" />
        </>
      ) : persona === 'draw' ? (
        <>
          <CmdButton id="geometry.unite" icon="unite" />
          <CmdButton id="geometry.subtract" icon="subtract" />
          <CmdButton id="geometry.intersect" icon="intersect" />
          <CmdButton id="geometry.exclude" icon="exclude" />
          <CmdButton id="geometry.divide" icon="divide" />
        </>
      ) : null}
      <span className="tsep" />
      <CmdButton id="arrange.alignLeft" icon="alignLeft" />
      <CmdButton id="arrange.alignHCenter" icon="alignHCenter" />
      <CmdButton id="arrange.alignRight" icon="alignRight" />
      <CmdButton id="arrange.alignTop" icon="alignTop" />
      <CmdButton id="arrange.alignVCenter" icon="alignVCenter" />
      <CmdButton id="arrange.alignBottom" icon="alignBottom" />
      <CmdButton id="arrange.distributeH" icon="distributeH" />
      <CmdButton id="arrange.distributeV" icon="distributeV" />
      <span className="tsep" />
      <CmdButton id="arrange.flipH" icon="flipH" />
      <CmdButton id="arrange.flipV" icon="flipV" />
      <CmdButton id="arrange.rotateLeft" icon="rotateLeft" />
      <CmdButton id="arrange.rotateRight" icon="rotateRight" />
      <span className="spacer" />
      <CmdButton id="edit.undo" icon="undo" />
      <CmdButton id="edit.redo" icon="redo" />
      <span className="tsep" />
      <button
        className="ib"
        title={t('view.toolsSide')}
        aria-label={t('view.toolsSide')}
        onClick={() => setSettings({ toolsSide: settings.toolsSide === 'right' ? 'left' : 'right' })}
      >
        <Icon name={settings.toolsSide === 'right' ? 'sideRight' : 'sideLeft'} />
      </button>
      <button className="btn primary" onClick={() => ui.set({ dialog: 'export' })}>
        <Icon name="export" />
        {t('file.export')}
      </button>
    </div>
  );
}
