/** Icônes de la barre du texte (16 × 16, au trait, dans le style de `components/Icon.tsx`). */
export const TEXT_ICONS = {
  justifyLeft: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M2.5 12.5h6',
  justifyCenter: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M5 12.5h6',
  justifyRight: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M7.5 12.5h6',
  justifyAll: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M2.5 12.5h11',
  valignTop: 'M2.5 2.5h11v11h-11z M5 5.5h6 M5 8h6',
  valignCenter: 'M2.5 2.5h11v11h-11z M5 6.8h6 M5 9.2h6',
  valignBottom: 'M2.5 2.5h11v11h-11z M5 8h6 M5 10.5h6',
  bullets: 'M6.5 4h7 M6.5 8h7 M6.5 12h7 M2.8 4h.6 M2.8 8h.6 M2.8 12h.6',
  numbers: 'M6.5 4h7 M6.5 8h7 M6.5 12h7 M2.5 3l1-.5v3 M2.3 7.3c.4-.6 1.7-.6 1.7.3 0 .7-1.7 1.2-1.7 2h1.8',
} as const;

export type TextIconName = keyof typeof TEXT_ICONS;

export function TextIcon({ name }: { name: TextIconName }) {
  return (
    <svg className="i" width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <path d={TEXT_ICONS[name]} />
    </svg>
  );
}
