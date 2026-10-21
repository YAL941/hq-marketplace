import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Package, Phone, RefreshCw, X } from 'lucide-react';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { SmartImage } from '../components/common/SmartImage';
import { orderApi } from '../services/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { CustomerOrderSummary, OrderStatus } from '../types';

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

export function MyOrdersPage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrderSummary | null>(null);
  const [offerActionId, setOfferActionId] = useState<string | null>(null);
  const [offerErrorId, setOfferErrorId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const response = await orderApi.listMine();
      setOrders(response.data.data);
      setError(false);
    } catch {
      if (!silent) setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!selectedOrder) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedOrder(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedOrder]);

  const reviewProduct = selectedOrder?.items.find((item) => item.product_id);
  const respondToOffer = async (order: CustomerOrderSummary, accept: boolean) => {
    setOfferActionId(order.order_id);
    setOfferErrorId(null);
    try {
      await orderApi.respondToDeliveryOffer(order.order_id, accept);
      await load(true);
    } catch {
      setOfferErrorId(order.order_id);
    } finally {
      setOfferActionId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{t('customerOrders.title')}</h1>
          <p className="mt-1 text-sm text-navy-500">{t('customerOrders.subtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('customerOrders.refresh')}
        </Button>
      </div>
      <p className="mb-4 text-xs text-navy-500">{t('customerOrders.autoRefresh')}</p>

      {error ? (
        <Card className="p-6 text-center">
          <p role="alert" className="text-sm text-error-600">{t('customerOrders.loadError')}</p>
          <Button type="button" className="mt-4" variant="outline" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : loading ? (
        <div className="space-y-4" role="status">
          {[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-navy-100" />)}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title={t('customerOrders.emptyTitle')}
          description={t('customerOrders.emptyBody')}
          action={
            <Link to="/explore" className="font-semibold text-primary-700 underline">
              {t('customerOrders.browse')}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li key={order.order_id}>
              <Card
                className="p-5 sm:p-6"
                hover={order.order_status === 'completed'}
                onClick={order.order_status === 'completed' ? () => setSelectedOrder(order) : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      {order.items[0] && (
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-navy-100">
                          <SmartImage
                            value={order.items[0].image_url}
                            alt={order.items[0].item_name}
                            width={64}
                            height={64}
                            className="h-full w-full object-cover"
                            fallback={<div className="flex h-full items-center justify-center text-navy-400"><Package className="h-6 w-6" aria-hidden="true" /></div>}
                          />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-navy-900">{order.business_name}</h2>
                          <Badge variant={STATUS_VARIANT[order.order_status]} size="sm">
                            {t(`orderStatus.${order.order_status}`)}
                          </Badge>
                        </div>
                        {order.items[0] && (
                          <p className="mt-1 truncate text-sm font-medium text-navy-700">
                            {order.items[0].item_name}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-navy-500">
                          {t('customerOrders.orderNumber', { number: order.order_number })}
                        </p>
                        <p className="mt-1 text-sm text-navy-600">
                          {t('customerOrders.paymentStatus')}: {t(`paymentStatus.${order.payment_status}`)}
                        </p>
                        {order.courier_phone && (
                          <a
                            href={`tel:${order.courier_phone}`}
                            className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-button border border-navy-300 px-3 text-sm font-medium text-navy-800 hover:bg-navy-50"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Phone className="h-4 w-4" aria-hidden="true" />
                            {t('customerOrders.callCourier')}: <span dir="ltr">{order.courier_phone}</span>
                          </a>
                        )}
                        <p className="mt-1 text-sm text-navy-500">
                          {t('order.placedOn', { date: formatDateTime(order.created_at) })}
                        </p>
                        <Link
                          to={`/orders/${order.order_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="mt-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          {t('customerOrders.viewDetails')}
                        </Link>
                        {order.delivery_status === 'offer_pending' && order.delivery_earning_amount && (
                          <div className="mt-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
                            <p className="text-sm font-semibold text-primary-900">
                              {t('customerOrders.deliveryOffer', {
                                amount: formatCurrency(order.delivery_earning_amount, order.currency),
                              })}
                            </p>
                            {offerErrorId === order.order_id && (
                              <p className="mt-2 text-sm text-error-700" role="alert">{t('customerOrders.offerResponseError')}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={offerActionId === order.order_id}
                                onClick={() => void respondToOffer(order, true)}
                              >
                                {t('customerOrders.acceptDeliveryOffer')}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={offerActionId === order.order_id}
                                onClick={() => void respondToOffer(order, false)}
                              >
                                {t('customerOrders.declineDeliveryOffer')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-end">
                    <p className="text-lg font-bold text-navy-900">
                      {formatCurrency(order.total_amount, order.currency)}
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedOrder(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="completed-order-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-success-600" aria-hidden="true" />
                <h2 id="completed-order-title" className="text-lg font-bold text-navy-900">
                  {t('customerOrders.completedTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="rounded-lg p-1 text-navy-500 hover:bg-navy-100"
                aria-label={t('customerOrders.close')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-sm text-navy-600">
              {t('customerOrders.completedMessage', {
                business: selectedOrder.business_name,
                number: selectedOrder.order_number,
              })}
            </p>
            {reviewProduct?.product_id && (
              <Link
                to={`/business/${selectedOrder.business_slug}?product=${reviewProduct.product_id}#product-feedback`}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                {t('customerOrders.rateProduct')}
              </Link>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
