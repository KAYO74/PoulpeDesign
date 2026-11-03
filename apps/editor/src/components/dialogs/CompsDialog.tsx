import { addComp, applyComp, removeComp, updateComp } from '@poulpe/core';
import { useState } from 'react';
import { useT } from '../../i18n';
import { editor, useEditor } from '../../store';
import { Modal } from './Modal';
import { close } from './close';

/** Variantes de calques : enregistrer l'état des calques et le rappeler en un clic. */
export function CompsDialog() {
  const t = useT();
  useEditor();
  const comps = editor.doc.comps ?? [];
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim() || t('comps.default', { n: comps.length + 1 });
    editor.apply('history.compAdd', (d) => {
      addComp(d, n);
    });
    setName('');
  };
  return (
    <Modal title={t('comps.title')} onClose={close}>
      <p className="note">{t('comps.hint')}</p>
      {comps.length === 0 && <p className="note">{t('comps.empty')}</p>}
      {comps.map((c) => (
        <div key={c.id} className="field" data-testid="comp-row">
          <span className="field-label">{c.name}</span>
          <button
            className="btn"
            data-testid="comp-apply"
            onClick={() =>
              editor.apply('history.compApply', (d) => {
                applyComp(d, c.id);
              })
            }
          >
            {t('comps.apply')}
          </button>
          <button
            className="btn"
            onClick={() =>
              editor.apply('history.compUpdate', (d) => {
                updateComp(d, c.id);
              })
            }
          >
            {t('comps.update')}
          </button>
          <button
            className="btn"
            onClick={() =>
              editor.apply('history.compDelete', (d) => {
                removeComp(d, c.id);
              })
            }
          >
            {t('comps.delete')}
          </button>
        </div>
      ))}
      <input
        className="input"
        placeholder={t('comps.name')}
        value={name}
        data-testid="comp-name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" onClick={add} data-testid="comp-add">
          {t('comps.add')}
        </button>
      </footer>
    </Modal>
  );
}
