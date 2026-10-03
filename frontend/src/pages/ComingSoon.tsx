import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';

/**
 * A placeholder for the pages the product does not have yet.
 *
 * `/terms`, `/privacy` and `/forgot-password` are linked from the auth screens
 * because a signup form that references a policy page has to have that page
 * exist. Rendering "coming soon" is better than the alternative, which was a
 * link that silently redirected to the home page and looked broken.
 */
const PAGES: Record<string, string> = {
  '/terms': 'terms',
  '/privacy': 'privacy',
  '/forgot-password': 'forgot-password',
};

export function ComingSoonPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const key = PAGES[pathname] ?? 'page';

  return (
    <div className="min-h-screen bg-navy-50 flex items-center justify-center px-4 py-16">
      <Card className="p-8 max-w-md w-full text-center">
        <Construction className="w-12 h-12 text-primary-500 mx-auto mb-5" strokeWidth={1.75} aria-hidden="true" />
        <h1 className="text-2xl font-bold text-navy-900 mb-2">
          {t(`soon.${key}Title`)}
        </h1>
        <p className="text-navy-500 mb-6">{t(`soon.${key}Body`)}</p>
        <Link to="/">
          <Button variant="outline">{t('soon.backHome')}</Button>
        </Link>
      </Card>
    </div>
  );
}