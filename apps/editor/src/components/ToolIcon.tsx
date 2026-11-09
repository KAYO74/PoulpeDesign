import { Icon, type IconName } from './Icon';
import { LUCIDE_TOOLS } from './lucideTools';

/**
 * Icône d'un outil ou d'un espace de travail : le dessin Lucide (24 × 24) quand il y en a un,
 * sinon celui de Poulpe. Les menus et les panneaux gardent `Icon`.
 */
export function ToolIcon({ name, size = 16 }: { name: string; size?: number }) {
  const entry = LUCIDE_TOOLS[name];
  if (!entry) return <Icon name={name as IconName} size={size} />;
  return (
    <svg className="i lucide" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {entry.nodes.map(([tag, attrs], i) => {
        const Shape = tag;
        return <Shape key={i} {...attrs} />;
      })}
    </svg>
  );
}
