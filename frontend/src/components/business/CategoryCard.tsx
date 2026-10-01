import { useTranslation } from 'react-i18next';
import { Card } from '../common/Card';
import { CategoryIcon } from '../common/CategoryIcon';
import { Link } from 'react-router-dom';
import type { PublicCategory } from '../../types';

interface CategoryCardProps {
  category: PublicCategory;
}

/** The whole card is one link, so the click target is not just the title. */
export function CategoryCard({ category }: CategoryCardProps) {
  const { t } = useTranslation();

  return (
    <Card padding="md" className="text-center" hover>
      <Link
        to={`/categories/${category.category_slug}`}
        className="flex flex-col items-center gap-3"
      >
        <CategoryIcon slug={category.category_slug} size="card" />
        <h3 className="font-semibold text-navy-900 text-base">{category.category_name}</h3>
        <span className="text-sm text-navy-500">
          {t('category.businessCount', { count: category.business_count })}
        </span>
      </Link>
    </Card>
  );
}