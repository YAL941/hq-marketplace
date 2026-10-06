import {
  BedDouble, Building2, Car, CircleEllipsis, Gem, GraduationCap, HeartPulse, Landmark, Leaf, Monitor,
  PawPrint, Pill, Plane, Shirt, ShoppingBag, Sparkles, Stethoscope, Store, Truck,
  Utensils, Wifi, Wrench, Zap, Briefcase, type LucideIcon,
} from 'lucide-react';

/**
 * The one place a category slug becomes an icon.
 *
 * This is a lookup, not data: the server has no icon column, and the category
 * table is seeded with fixed slugs. A slug that is not listed falls back to
 * `Store`, so a category added to the database later still renders a mark
 * instead of a blank space.
 *
 * Keys are duplicated on purpose. The six slugs in the brand spec and the
 * slugs actually seeded by migration 004 do not fully overlap — the database
 * says `healthcare`, not `hospitals`, and `grocery-retail`, not `shops`. Both
 * spellings are mapped so the icon appears whichever slug a category has.
 */
const SLUG_ICONS: Record<string, LucideIcon> = {
  // the slugs named in the brand spec
  restaurants: Utensils,
  hospitals: Stethoscope,
  pharmacies: Pill,
  'wedding-halls': Gem,
  hotels: BedDouble,
  shops: ShoppingBag,

  // the slugs migration 004 actually seeds, and their nearest spec equivalent
  healthcare: HeartPulse,
  'events-venues': Gem,
  'grocery-retail': ShoppingBag,
  agriculture: Leaf,
  education: GraduationCap,
  transportation: Truck,
  'professional-services': Briefcase,
  technology: Monitor,
  'beauty-wellness': Sparkles,
  'local-products': Shirt,
  'clinics-laboratories': Stethoscope,
  automotive: Car,
  'construction-real-estate': Building2,
  'finance-insurance': Landmark,
  'telecom-internet': Wifi,
  'travel-tourism': Plane,
  animals: PawPrint,
  'home-services': Wrench,
  'water-energy': Zap,
  'ngo-community-services': HeartPulse,
  books: Building2,
  other: CircleEllipsis,
};

/** The single icon size, chosen so every line icon has the same optical weight. */
const STROKE_WIDTH = 1.75;

const BADGES = {
  /** Category chips on a dark hero. */
  chip: {
    box: 'w-[30px] h-[30px]',
    icon: 'w-[17px] h-[17px]',
    badge: 'bg-[rgba(255,200,61,0.18)] text-[#FFC83D]',
  },
  /** Category cards on a light page. */
  card: {
    box: 'w-[52px] h-[52px]',
    icon: 'w-[26px] h-[26px]',
    badge: 'bg-[#EAF4FF] text-[#1E78D6]',
  },
  /**
   * A category mark inside an already light surface, such as a business card's
   * category row. The `chip` preset cannot be reused there: gold on gold at
   * 18% opacity over white leaves the icon at roughly 1.9:1.
   */
  inline: {
    box: 'w-7 h-7',
    icon: 'w-4 h-4',
    badge: 'bg-[#EAF4FF] text-[#1E78D6]',
  },
} as const;

type BadgeSize = keyof typeof BADGES;

interface CategoryIconProps {
  slug: string | null | undefined;
  /** `chip` on a dark hero, `card` on a light surface. */
  size?: BadgeSize;
  className?: string;
}

/**
 * A decorative category mark inside a round badge.
 *
 * `aria-hidden` because the category name is always rendered as visible text
 * next to it; announcing a decorative glyph as well would make a screen reader
 * say "store" before the name that already says it.
 */
export function CategoryIcon({ slug, size = 'card', className = '' }: CategoryIconProps) {
  const Icon = (slug && SLUG_ICONS[slug]) || Store;
  const dims = BADGES[size];

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full flex-shrink-0 ${dims.box} ${dims.badge} ${className}`}
      aria-hidden="true"
    >
      <Icon className={dims.icon} strokeWidth={STROKE_WIDTH} fill="none" />
    </span>
  );
}

/** The icon alone, for the rare caller that already owns its badge. */
export function categoryIconFor(slug: string | null | undefined): LucideIcon {
  return (slug && SLUG_ICONS[slug]) || Store;
}

export default CategoryIcon;