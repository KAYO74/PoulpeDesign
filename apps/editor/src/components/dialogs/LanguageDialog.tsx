import { pickStartLanguage } from '../../startLanguage';
import { getLang } from '../../i18n';
import { Modal } from './Modal';

/** Premier lancement de l'appli de bureau sans langue choisie à l'installation. */
export function LanguageDialog() {
  const lang = getLang();
  return (
    <Modal title="Langue · Language" onClose={() => pickStartLanguage(lang)}>
      <p>
        Choisissez la langue de Poulpe Design.
        <br />
        Choose the language of Poulpe Design.
      </p>
      <p className="note">
        Vous pourrez la changer dans Édition &gt; Préférences.
        <br />
        You can change it later in Edit &gt; Preferences.
      </p>
      <footer>
        <button
          className={`btn${lang === 'fr' ? ' primary' : ''}`}
          data-testid="start-lang-fr"
          onClick={() => pickStartLanguage('fr')}
        >
          Français
        </button>
        <button
          className={`btn${lang === 'en' ? ' primary' : ''}`}
          data-testid="start-lang-en"
          onClick={() => pickStartLanguage('en')}
        >
          English
        </button>
      </footer>
    </Modal>
  );
}
