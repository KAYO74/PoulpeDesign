import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Item, Sep, Sub } from './MenuBar';

/** Ouvre le menu du clic droit sur le canevas, au point donné (coordonnées de la fenêtre). */
export function openCanvasMenu(x: number, y: number): void {
  window.dispatchEvent(new CustomEvent('poulpe:canvasmenu', { detail: { x, y } }));
}

/** Menu du clic droit sur le canevas : les commandes de l'objet sélectionné, comme dans Affinity. */
export function CanvasMenu() {
  const t = useT();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setAt((e as CustomEvent<{ x: number; y: number }>).detail);
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
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
