import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Item, Sep, Sub } from './MenuBar';

type MenuKind = 'objects' | 'nodes';

/**
 * Ouvre le menu du clic droit sur le canevas, au point donné (coordonnées de la fenêtre) : celui
 * des objets, ou celui des nœuds (outil Nœud).
 */
export function openCanvasMenu(x: number, y: number, kind: MenuKind = 'objects'): void {
  window.dispatchEvent(new CustomEvent('poulpe:canvasmenu', { detail: { x, y, kind } }));
}

/** Menu du clic droit sur le canevas : les commandes de l'objet sélectionné, comme dans Affinity. */
export function CanvasMenu() {
  const [at, setAt] = useState<{ x: number; y: number; kind: MenuKind } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setAt((e as CustomEvent<{ x: number; y: number; kind: MenuKind }>).detail);
    window.addEventListener('poulpe:canvasmenu', open);
    return () => window.removeEventListener('poulpe:canvasmenu', open);
  }, []);
  return (
    <Menu.Root open={!!at} onOpenChange={(o) => !o && setAt(null)} modal={false}>
      <Menu.Trigger asChild>
        <span
          aria-hidden
          className="context-anchor"
          style={{ position: 'fixed', left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="menu"
          side="right"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          data-testid="canvas-menu"
        >
          {at?.kind === 'nodes' ? <NodeItems /> : <ObjectItems />}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Menu des nœuds (outil Nœud) : les actions d'Affinity sur le nœud visé. */
function NodeItems() {
  const t = useT();
  return (
    <>
      <Item id="node.delete" />
      <Item id="node.fitDelete" />
      <Sep />
      <Sub label={t('node.convert')}>
        <Item id="node.sharp" />
        <Item id="node.smooth" />
        <Item id="node.smart" />
      </Sub>
      <Sep />
      <Item id="node.split" />
      <Item id="node.break" />
      <Item id="node.close" />
      <Item id="node.join" />
      <Item id="node.reverse" />
      <Item id="node.smoothCurve" />
    </>
  );
}

/** Menu des objets sélectionnés. */
function ObjectItems() {
  const t = useT();
  return (
    <>
      <Item id="edit.cut" />
      <Item id="edit.copy" />
      <Item id="edit.paste" />
      <Item id="edit.duplicate" />
      <Sep />
      <Item id="layer.group" />
      <Item id="layer.ungroup" />
      <Sep />
      <Sub label={t('menu.order')}>
        <Item id="arrange.front" />
        <Item id="arrange.forward" />
        <Item id="arrange.backward" />
        <Item id="arrange.back" />
      </Sub>
      <Sub label={t('menu.align')}>
        <Item id="arrange.alignLeft" />
        <Item id="arrange.alignHCenter" />
        <Item id="arrange.alignRight" />
        <Sep />
        <Item id="arrange.alignTop" />
        <Item id="arrange.alignVCenter" />
        <Item id="arrange.alignBottom" />
        <Sep />
        <Item id="arrange.distributeH" />
        <Item id="arrange.distributeV" />
      </Sub>
      <Sub label={t('menu.geometry')}>
        <Item id="geometry.unite" />
        <Item id="geometry.subtract" />
        <Item id="geometry.intersect" />
        <Item id="geometry.exclude" />
        <Item id="geometry.divide" />
      </Sub>
      <Sub label={t('menu.transform')}>
        <Item id="arrange.flipH" />
        <Item id="arrange.flipV" />
        <Item id="arrange.rotateLeft" />
        <Item id="arrange.rotateRight" />
      </Sub>
      <Sep />
      <Item id="layer.convertToCurves" />
      <Item id="layer.outlineStroke" />
      <Item id="layer.clip" />
      <Item id="layer.rasterize" />
      <Sep />
      <Item id="style.save" />
      <Item id="symbol.create" />
      <Sep />
      <Item id="layer.lock" />
      <Item id="layer.hide" />
      <Item id="edit.delete" />
    </>
  );
}
