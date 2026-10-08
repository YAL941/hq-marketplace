import {
  BedDouble, Building2, Car, CircleEllipsis, Gem, GraduationCap, HeartPulse, Landmark, Leaf, Monitor,
  PawPrint, Pill, Plane, Shirt, ShoppingBag, Sparkles, Stethoscope, Truck,
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
export const SLUG_ICONS: Record<string, LucideIcon> = {
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
