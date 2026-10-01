import { useTranslation } from 'react-i18next';
import { Card } from '../common/Card';
import {
  Utensils, HeartPulse, ShoppingBag, Hotel, Calendar, GraduationCap, Truck, Briefcase,
  Monitor, Sparkles, Leaf, MoreHorizontal, PawPrint, Wrench, Shirt, BookOpen, Car,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PublicCategory } from '../../types';

/**
 * Icons are keyed by slug. This is a lookup, not data: the server has no icon
 * column, and a category without an entry here falls back to a neutral mark
 * rather than a broken image.
 */
const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  healthcare: HeartPulse,
  restaurants: Utensils,
  'grocery-retail': ShoppingBag,
  hotels: Hotel,
  'events-venues': Calendar,
  agriculture: Leaf,
  education: GraduationCap,
  transportation: Truck,
  'professional-services': Briefcase,
  technology: Monitor,
  'beauty-wellness': Sparkles,
  'local-products': Shirt,
  automotive: Car,
  animals: PawPrint,
  'home-services': Wrench,
  books: BookOpen,
  other: MoreHorizontal,
};

interface CategoryCardProps {
  category: PublicCategory;
}

/** The whole card is one link, so the click target is not just the title. */
export function CategoryCard({ category }: CategoryCardProps) {
  const { t } = useTranslation();
  const Icon = categoryIcons[category.category_slug] ?? MoreHorizontal;

  return (
    <Card padding="md" className="text-center" hover>
      <Link
        to={`/categories/${category.category_slug}`}
        className="flex flex-col items-center gap-3"
      >
        <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600">
          <Icon className="w-7 h-7" />
        </div>
        <h3 className="font-semibold text-navy-900 text-base">{category.category_name}</h3>
        <span className="text-sm text-navy-500">
          {t('category.businessCount', { count: category.business_count })}
        </span>
      </Link>
    </Card>
  );
}
