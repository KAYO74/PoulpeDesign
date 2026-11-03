import { Component, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Modal } from './dialogs/Modal';

function LoadError({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('loaderr.title')} onClose={onClose} small top>
      <p data-testid="load-error">{t('loaderr.text')}</p>
      <footer>
        <button data-testid="load-error-close" onClick={onClose}>
          {t('loaderr.close')}
        </button>
        <span className="spacer" />
        <button className="primary" data-testid="load-error-reload" onClick={() => location.reload()}>
          {t('loaderr.reload')}
        </button>
      </footer>
    </Modal>
  );
}

/**
 * Barrière d'erreur autour des morceaux de code chargés à la demande (fenêtres, photothèque) :
 * si l'un ne vient pas (réseau coupé, site mis à jour pendant que l'onglet restait ouvert), on
 * propose de recharger la page au lieu de laisser l'appli devenir blanche.
 */
export class LoadErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Chargement à la demande impossible', error);
  }

  private close = () => {
    this.setState({ failed: false });
    this.props.onClose();
  };

  override render() {
    return this.state.failed ? <LoadError onClose={this.close} /> : this.props.children;
  }
}
