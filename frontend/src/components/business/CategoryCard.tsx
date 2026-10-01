import { Card } from '../common/Card';
import { Utensils, HeartPulse, ShoppingBag, Hotel, Calendar, GraduationCap, Truck, Briefcase, Monitor, Sparkles, Leaf, MoreHorizontal } from 'lucide-react';
import type { CategorySummary } from '../../types';

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  'healthcare': HeartPulse,
  'restaurants': Utensils,
  'grocery-retail': ShoppingBag,
  'hotels': Hotel,
  'events-venues': Calendar,
  'agriculture': Leaf,
  'education': GraduationCap,
  'transportation': Truck,
  'professional-services': Briefcase,
  'technology': Monitor,
  'beauty-wellness': Sparkles,
  'local-products': Leaf,
  'other': MoreHorizontal,
};

interface CategoryCardProps {
  category: CategorySummary;
  onClick?: () => void;
  businessCount?: number;
}

export function CategoryCard({ category, onClick, businessCount }: CategoryCardProps) {
  const Icon = categoryIcons[category.category_slug] || MoreHorizontal;

  return (
    <Card
      padding="md"
      className="text-center flex flex-col items-center gap-3"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="font-semibold text-navy-900 text-base">{category.category_name}</h3>
      {businessCount !== undefined && (
        <span className="text-sm text-navy-500">{businessCount} businesses</span>
      )}
    </Card>
  );
}