import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Package, ChevronLeft } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import {
  OffsetPagerView, StaffListLayout, useOffsetPager,
} from '../components/common/OffsetPager';
import { orderApi } from '../services/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { Id, Order, OrderStatus } from '../types';

const PAGE_SIZE = 20;

const STATUSES: Array<OrderStatus | ''> = [
  '', 'pending', 'confirmed', 'in_progress', 'ready',
  'out_for_delivery', 'completed', 'cancelled', 'rejected', 'refunded',
];

/** The tone of each status pill, so a cancelled order does not look active. */
const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'info',
  ready: 'info',
  out_for_delivery: 'info',
  completed: 'success',
  cancelled: 'danger',
  rejected: 'danger',
  refunded: 'default',
};

/**
 * The owner's order list.
 *
 * There is no total anywhere in this response, only the length of the page that
 * arrived, so the pager says "Showing 1–20" and nothing more. It deliberately
 * does not claim to know how many orders exist.
 */
export function DashboardOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: Id }>();
  const businessId = params.businessId ?? '';

  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const pager = useOffsetPager(PAGE_SIZE, { filterKey: status });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await orderApi.listForBusiness(businessId, {
        limit: PAGE_SIZE,
        offset: pager.offset,
        orderStatus: status || undefined,
      });
      setOrders(res.data.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, pager.offset, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onStatusChange = (value: string) => {
    pager.reset();
    setStatus(value as OrderStatus | '');
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('order.title')}</h1>
        <div>
          <label htmlFor="order-status-filter" className="sr-only">{t('order.status')}</label>
          <select
            id="order-status-filter"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="rounded-button border border-navy-300 px-3 py-2.5 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? t(`orderStatus.${value}`) : t('order.allStatuses')}
              </option>
            ))}
          </select>
        </div>
      </div>

      <StaffListLayout
        loading={loading}
        error={error}
        isEmpty={orders.length === 0}
        onRetry={() => void load()}
        empty={
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title={t('order.emptyTitle')}
            description={t('order.emptyBody')}
          />
        }
      >
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.order_id} padding="none" className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-navy-900">{order.order_number}</h3>
                    <Badge variant={STATUS_VARIANT[order.order_status]} size="sm">
                      {t(`orderStatus.${order.order_status}`)}
                    </Badge>
                  </div>
                  <p className="text-sm text-navy-500 mt-0.5">
                    {t('order.placedOn', { date: formatDateTime(order.created_at) })}
                  </p>
                  <p className="text-xs text-navy-400 mt-0.5">
                    {t('order.type')}: {t(`orderType.${order.order_type}`, { defaultValue: order.order_type })}
                  </p>
                </div>

                <p className="font-semibold text-navy-900">
                  {formatCurrency(order.total_amount, order.currency)}
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/dashboard/business/${businessId}/orders/${order.order_id}`)
                  }
                >
                  {t('order.viewDetails')}
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <OffsetPagerView pager={pager} returned={orders.length} pageSize={PAGE_SIZE} disabled={loading} />
      </StaffListLayout>

      <p className="mt-6 text-xs text-navy-400">
        <Link to={`/dashboard/business/${businessId}`} className="inline-flex items-center gap-1 hover:text-navy-600">
          <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
          {t('nav.dashboard')}
        </Link>
      </p>
    </div>
  );
}