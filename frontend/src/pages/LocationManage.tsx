/**
 * Branch management.
 *
 * Placeholder only. The route `/dashboard/locations` is mounted in App.tsx and
 * previously pointed at a zero-byte file, which broke the whole build with
 * TS2613. The page renders, and says plainly that it is not wired up yet,
 * rather than shipping an empty screen or pretending the feature exists.
 *
 * The API it will need already exists:
 *   GET   /api/business/:businessId/locations        (staff)
 *   POST  /api/business/:businessId/locations
 *   PATCH /api/business/:businessId/locations/:locationId
 *   GET   /api/businesses/:businessId/locations       (public, anonymous)
 *
 * Note that opening hours belong to the business (business_opening_hours), not
 * to a branch, so this page will manage addresses and phones only.
 */
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { MapPin } from 'lucide-react';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';

export function LocationManagePage() {
  const { t } = useTranslation();
  const { currentBusiness } = useAuth();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">{t('branches.title')}</h1>
        <p className="text-navy-500">{t('brand.tagline')}</p>
      </div>

      <Card>
        <EmptyState
          icon={<MapPin className="w-8 h-8" />}
          title={t('branches.notWiredTitle')}
          description={t('branches.notWiredDescription')}
        />
      </Card>

      {currentBusiness && (
        <p className="text-sm text-navy-500">
          {t('sidebar.currentBusiness')}: {currentBusiness.business_name}
        </p>
      )}
    </div>
  );
}
