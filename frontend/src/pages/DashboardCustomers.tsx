import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';

/**
 * Customers.
 *
 * There is no customers endpoint. `GET /api/business/:businessId/orders` returns
 * `customer_id` as a bare id and nothing joins it to a name, so a customer list
 * would have to invent one; `business_statistics.total_customers` is a single
 * count and says nothing about who.
 *
 * So the screen states the gap instead of drawing a table of invented people.
 * What the API does support is on the orders screen: an order carries its
 * `customer_id`, and that id is shown as an id.
 */
export function DashboardCustomersPage() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy-900 mb-6">{t('customers.title')}</h1>

      <Card>
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          title={t('customers.notAvailableTitle')}
          description={t('customers.notAvailableBody')}
        />
      </Card>

      <p className="mt-4 text-xs text-navy-400">{t('customers.gapReason')}</p>
    </div>
  );
}