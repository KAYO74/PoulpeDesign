import { useT } from '../../i18n';
import { Modal } from './Modal';
import { close } from './close';

export function AboutDialog() {
  const t = useT();
  return (
    <Modal title={t('help.about')} onClose={close}>
      <p>{t('help.aboutText', { version: __APP_VERSION__ })}</p>
    </Modal>
  );
}
