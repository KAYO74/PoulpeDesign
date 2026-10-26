import { getLang, useT } from '../i18n';
import { ui, useUi } from '../store';
import { RELEASES } from '../whatsNew';
import { Modal } from './dialogs/Modal';

const close = () => ui.set({ whatsNewOpen: false });

/** Les nouveautés de la version installée, puis des précédentes, en phrases courtes. */
export function WhatsNewDialog() {
  const t = useT();
  const open = useUi((s) => s.whatsNewOpen);
  if (!open) return null;
  const lang = getLang();
  return (
    <Modal title={t('whatsNew.title')} onClose={close} top>
      <div className="whats-new" data-testid="whats-new">
        {RELEASES.map((r) => (
          <section key={r.version}>
            <h3>{t('whatsNew.version', { version: r.version })}</h3>
            <ul>
              {(lang === 'fr' ? r.fr : r.en).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <footer>
        <button className="primary" onClick={close}>
          {t('whatsNew.ok')}
        </button>
      </footer>
    </Modal>
  );
}
