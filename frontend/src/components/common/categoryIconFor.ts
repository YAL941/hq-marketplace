import { Store, type LucideIcon } from 'lucide-react';
import { SLUG_ICONS } from './categoryIcons';

/** The icon alone, for the rare caller that already owns its badge. */
export function categoryIconFor(slug: string | null | undefined): LucideIcon {
  return (slug && SLUG_ICONS[slug]) || Store;
}
