import { useState } from 'react';
import { useT, type MessageKey } from '../i18n';
import { ui, useUi } from '../store';
import { Icon, type IconName } from './Icon';
import { ToolIcon } from './ToolIcon';
import { Modal } from './dialogs/Modal';

const close = () => ui.set({ tourOpen: false });

/** Les étapes de la visite : une icône, un titre et deux phrases chacune (textes dans i18n-tour.ts). */
const STEPS: { n: number; icon: IconName }[] = [
  { n: 1, icon: 'tabDraw' },
  { n: 2, icon: 'search' },
  { n: 3, icon: 'tabLayout' },
  { n: 4, icon: 'photoLibrary' },
  { n: 5, icon: 'tabPhoto' },
  { n: 6, icon: 'tabExport' },
];

/** Visite guidée de 2 minutes : au premier lancement, et dans Aide > Visite guidée. */
export function TourDialog() {
  const open = useUi((s) => s.tourOpen);
  if (!open) return null;
  return <Tour />;
}

function Tour() {
  const t = useT();
  const [at, setAt] = useState(0);
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  return (
    <Modal title={t('tour.title')} onClose={close} top>
      <div className="tour" data-testid="tour">
        <div className="tour-icon" aria-hidden="true">
          <ToolIcon name={step.icon} size={28} />
        </div>
        <h3>{t(`tour.s${step.n}.title` as MessageKey)}</h3>
        <p>{t(`tour.s${step.n}.text` as MessageKey)}</p>
        {step.n === 5 && (
          <button
            data-testid="tour-switch"
            onClick={() => ui.set({ tourOpen: false, dialog: 'help', helpTab: 'switch' })}
          >
            {t('tour.s5.link')}
          </button>
        )}
        <div className="tour-dots" role="presentation">
          {STEPS.map((s, i) => (
            <span key={s.n} className={i === at ? 'on' : undefined} />
          ))}
        </div>
        <span className="muted tour-count">{t('tour.step', { n: at + 1, total: STEPS.length })}</span>
      </div>
      <footer>
        {!last && (
          <button data-testid="tour-skip" onClick={close}>
            {t('tour.skip')}
          </button>
        )}
        <span className="spacer" />
        {at > 0 && <button onClick={() => setAt(at - 1)}>{t('tour.prev')}</button>}
        <button className="primary" data-testid="tour-next" onClick={() => (last ? close() : setAt(at + 1))}>
          {last ? t('tour.done') : t('tour.next')}
        </button>
      </footer>
    </Modal>
  );
}
