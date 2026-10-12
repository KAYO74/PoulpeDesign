import { discardDraft, getPendingDraft, restoreDraft } from '../../drafts';
import { getLang, useT } from '../../i18n';
import { Modal } from './Modal';

export function DraftDialog() {
  const t = useT();
  const draft = getPendingDraft();
  if (!draft) return null;
  const date = new Date(draft.savedAt).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <Modal title={t('draft.title')} onClose={discardDraft}>
      <p>{t('draft.body', { name: draft.doc.name, date })}</p>
      <footer>
        <button className="btn" onClick={discardDraft}>
          {t('draft.discard')}
        </button>
        <button className="btn primary" data-testid="draft-restore" onClick={restoreDraft}>
          {t('draft.restore')}
        </button>
      </footer>
    </Modal>
  );
}
