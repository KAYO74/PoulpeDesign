import { applyBlend } from '@poulpe/core';
import { useState } from 'react';
import { useT } from '../../i18n';
import { editor } from '../../store';
import { NumberField } from '../fields';
import { Modal } from './Modal';
import { close } from './close';

/** Dégradé de formes (comme l'outil Dégradé d'Illustrator) : formes intermédiaires entre deux formes. */
export function BlendDialog() {
  const t = useT();
  const [n, setN] = useState(5);
  const go = () => {
    close();
    const ids = editor.selection;
    editor.apply('history.blend', (d) => {
      const id = applyBlend(d, ids, n, t('shapeBlend.name'));
      return id ? [id] : undefined;
    });
  };
  return (
    <Modal title={t('shapeBlend.title')} onClose={close}>
      <p className="hint">{t('shapeBlend.hint')}</p>
      <NumberField
        label={t('shapeBlend.steps')}
        value={n}
        min={1}
        max={100}
        width={80}
        testId="blend-steps"
        onChange={(v) => setN(Math.max(1, Math.min(100, Math.round(v))))}
      />
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" onClick={go} data-testid="blend-go">
          {t('shapeBlend.go')}
        </button>
      </footer>
    </Modal>
  );
}
