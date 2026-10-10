import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package, MapPin, StickyNote, Clock } from 'lucide-react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { SmartImage } from '../components/common/SmartImage';
import { orderApi, toFieldIssue, type FieldIssue } from '../services/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { Id, OrderDetail, OrderStatus, SettableOrderStatus } from '../types';

const STATUS_TRANSITIONS: Partial<Record<OrderStatus, SettableOrderStatus[]>> = {
  pending: ['confirmed', 'cancelled', 'rejected'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'out_for_delivery', 'completed', 'cancelled'],
  ready: ['out_for_delivery', 'completed', 'cancelled'],
  out_for_delivery: ['completed', 'cancelled'],
};

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
 * One order, its lines and its status.
 *
 * The items come from the same response as the order, so they are shown as they
 * were when the order was placed: `item_name` is a copy, which is why a product
 * deleted since then still has a name here.
 *
 * What this screen cannot show is who placed it. The endpoint returns
 * `customer_id` as a bare id and joins nothing to it, so the id is printed as an
 * id. Turning it into a name would mean either inventing one or calling an
 * endpoint that does not exist.
 */
export function OrderDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ businessId: Id; orderId: Id }>();
  const businessId = params.businessId ?? '';
  const orderId = params.orderId ?? '';

  const [data, setData] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<FieldIssue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await orderApi.getForBusiness(businessId, orderId);
      setData(res.data.data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (next: SettableOrderStatus) => {
    setSaving(true);
    setIssue(null);
    try {
      const res = await orderApi.updateStatus(businessId, orderId, next);
      // The status endpoint returns the whole order, so the badge updates from
      // the server's answer rather than from what was requested.
      setData((prev) => (prev ? { ...prev, order: res.data.data } : prev));
    } catch (error) {
      setIssue(toFieldIssue(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <EmptyState
        icon={<Package className="w-8 h-8" />}
        title={t('order.notFoundTitle')}
        action={
          <Button variant="outline" onClick={() => navigate(`/dashboard/business/${businessId}/orders`)}>
            {t('order.backToList')}
          </Button>
        }
      />
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" height={90} />
        ))}
      </div>
    );
  }

  const { order, items } = data;
  const availableStatuses = STATUS_TRANSITIONS[order.order_status] ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(`/dashboard/business/${businessId}/orders`)}
        className="inline-flex items-center gap-1 text-sm text-navy-500 hover:text-navy-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        {t('order.backToList')}
      </button>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{order.order_number}</h1>
        <Badge variant={STATUS_VARIANT[order.order_status]} size="sm">
          {t(`orderStatus.${order.order_status}`)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-4">{t('order.items')}</h2>
            {items.length === 0 ? (
              <p className="text-sm text-navy-500">{t('order.noItems')}</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {items.map((item) => (
                  <li key={item.order_item_id} className="py-3 flex items-start gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-navy-100">
                      <SmartImage
                        value={item.image_url}
                        alt={item.item_name}
                        width={80}
                        height={80}
                        className="h-full w-full object-cover"
                        fallback={<div className="flex h-full items-center justify-center text-navy-400"><Package className="h-7 w-7" aria-hidden="true" /></div>}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-navy-900">{item.item_name}</p>
                      <p className="text-sm text-navy-500">
                        {t('order.quantityAndUnit', {
                          quantity: item.quantity,
                          price: formatCurrency(item.unit_price, order.currency),
                        })}
                      </p>
                      <p className="text-xs text-navy-400 mt-0.5">
                        {t(`orderType.${item.item_type}`, { defaultValue: item.item_type })}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-navy-400 mt-1">{item.notes}</p>
                      )}
                    </div>
                    <p className="font-medium text-navy-900">
                      {formatCurrency(item.total_price, order.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(order.delivery_address || order.customer_note || order.scheduled_for) && (
            <Card className="p-5">
              <h2 className="font-semibold text-navy-900 mb-4">{t('order.details')}</h2>
              <dl className="space-y-3 text-sm">
                {order.delivery_address && (
                  <div className="flex gap-2">
                    <dt className="shrink-0"><MapPin className="w-4 h-4 text-navy-400" aria-hidden="true" /></dt>
                    <dd className="text-navy-700">{order.delivery_address}</dd>
                  </div>
                )}
                {order.customer_note && (
                  <div className="flex gap-2">
                    <dt className="shrink-0"><StickyNote className="w-4 h-4 text-navy-400" aria-hidden="true" /></dt>
                    <dd className="text-navy-700">{order.customer_note}</dd>
                  </div>
                )}
                {order.scheduled_for && (
                  <div className="flex gap-2">
                    <dt className="shrink-0"><Clock className="w-4 h-4 text-navy-400" aria-hidden="true" /></dt>
                    <dd className="text-navy-700">{formatDateTime(order.scheduled_for)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-4">{t('order.totals')}</h2>
            <dl className="space-y-2 text-sm">
              {[
                ['subtotal', order.subtotal],
                ['deliveryFee', order.delivery_fee],
                ['discountAmount', order.discount_amount],
                ['taxAmount', order.tax_amount],
              ].map(([key, amount]) => (
                <div key={key} className="flex justify-between">
                  <dt className="text-navy-500">{t(`order.${key}`)}</dt>
                  <dd className="text-navy-900">{formatCurrency(amount, order.currency)}</dd>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-navy-200 font-semibold">
                <dt className="text-navy-900">{t('order.total')}</dt>
                <dd className="text-navy-900">{formatCurrency(order.total_amount, order.currency)}</dd>
              </div>
            </dl>

            {/* The only handle the API gives on the person who placed this:
                the bare id. No name is shown because none is returned. */}
            <div className="mt-4 pt-4 border-t border-navy-100">
              <dt className="text-navy-500 text-xs">{t('order.customerId')}</dt>
              <dd className="text-navy-900 text-sm font-mono">{order.customer_id}</dd>
              <p className="text-xs text-navy-400 mt-1">{t('order.customerNameUnavailable')}</p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy-900 mb-1">{t('order.changeStatus')}</h2>
            <p className="text-xs text-navy-500 mb-4">{t('order.statusHint')}</p>

            {issue && (
              <p className="mb-3 p-3 bg-error-50 border border-error-200 rounded-button text-error-700 text-sm" role="alert">
                {issue.message || t('common.saveFailed')}
              </p>
            )}

            {availableStatuses.length === 0 ? (
              <p className="text-sm text-navy-500">{t('order.statusLocked')}</p>
            ) : (
              <div className="space-y-2">
                {availableStatuses.map((value) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="sm"
                    className="w-full"
                    loading={saving}
                    disabled={saving}
                    onClick={() => void changeStatus(value)}
                  >
                    {t(`orderStatus.${value}`)}
                  </Button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}