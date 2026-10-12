import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { Icon } from '../Icon';

export function Modal({
  title,
  children,
  onClose,
  wide,
  xl,
  small,
  top,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  xl?: boolean;
  /** Petite fenêtre (message court). */
  small?: boolean;
  /** Au-dessus des autres fenêtres ouvertes. */
  top?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button.primary, button')?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      className={`modal-backdrop${top ? ' top' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={`modal${wide ? ' wide' : ''}${xl ? ' xl' : ''}${small ? ' small' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="ib" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
