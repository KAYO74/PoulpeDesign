import { useState } from 'react';
import { useT } from '../../i18n';
import { editor } from '../../store';
import { saveCurrentAsTemplate } from '../../userTemplates';
import { Modal } from './Modal';
import { close } from './close';

/** Fichier › Enregistrer comme modèle : demande le nom du modèle. */
export function SaveTemplateDialog() {
  const t = useT();
  const [name, setName] = useState(editor.doc.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    if (await saveCurrentAsTemplate(name.trim())) close();
    else setBusy(false);
  };
  return (
    <Modal title={t('mytpl.save')} onClose={close} small>
      <label className="ws-name">
        <span>{t('mytpl.namePrompt')}</span>
        <input
          className="text-input"
          value={name}
          data-testid="template-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </label>
      <footer>
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button
          className="btn primary"
          data-testid="template-save"
          disabled={!name.trim() || busy}
          onClick={() => void save()}
        >
          {t('file.save')}
        </button>
      </footer>
    </Modal>
  );
}
