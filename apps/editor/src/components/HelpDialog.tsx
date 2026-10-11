import { useT } from '../i18n';
import { isDesktop } from '../io';
import { toast, ui, useUi, type HelpTab } from '../store';
import { Modal } from './Dialogs';

const close = () => ui.set({ dialog: null });

const DOCS_URL = 'https://github.com/KAYO74/PoulpeDesign/tree/main/docs';
const FAQ = [1, 2, 3, 4, 5, 6];

/**
 * Aide > Documentation et Questions fréquentes : une aide courte, lisible sans connexion, avec un
 * lien vers la documentation complète.
 */
export function HelpDialog() {
  const t = useT();
  const tab = useUi((s) => s.helpTab);
  const tabs: HelpTab[] = ['start', 'faq', 'performance'];
  return (
    <Modal title={t('help.title')} onClose={close} wide>
      <div className="seg help-tabs" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            data-testid={`help-tab-${id}`}
            onClick={() => ui.set({ helpTab: id })}
          >
            {t(`help.tab.${id}`)}
          </button>
        ))}
      </div>
      <div className="help-body" data-testid={`help-${tab}`}>
        {tab === 'start' && (
          <ul>
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>{t(`help.start.${n}`)}</li>
            ))}
          </ul>
        )}
        {tab === 'faq' && (
          <dl className="faq">
            {FAQ.map((n) => (
              <div key={n}>
                <dt>{t(`help.faq.q${n}`)}</dt>
                <dd>{t(`help.faq.a${n}`)}</dd>
              </div>
            ))}
          </dl>
        )}
        {tab === 'performance' && (
          <>
            <ul>
              {[1, 2, 3, 4].map((n) => (
                <li key={n}>{t(`help.perf.${n}`)}</li>
              ))}
            </ul>
            <button
              className="btn"
              onClick={() => ui.set({ dialog: 'preferences', prefsTab: 'performance' })}
            >
              {t('prefs.tab.performance')}…
            </button>
          </>
        )}
      </div>
      <footer>
        {isDesktop() ? (
          // L'appli de bureau n'ouvre pas de navigateur : le lien se copie.
          <button
            className="link"
            onClick={() =>
              void navigator.clipboard
                .writeText(DOCS_URL)
                .then(() => toast(DOCS_URL))
                .catch(() => {})
            }
          >
            {t('help.online')} : {DOCS_URL.replace('https://', '')}
          </button>
        ) : (
          <a className="link" href={DOCS_URL} target="_blank" rel="noreferrer">
            {t('help.online')}
          </a>
        )}
        <span className="spacer" />
        <button className="btn primary" onClick={close}>
          OK
        </button>
      </footer>
    </Modal>
  );
}
