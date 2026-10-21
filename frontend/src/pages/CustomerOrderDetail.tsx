import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Package, Phone, Star, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Skeleton } from '../components/common/Skeleton';
import { SmartImage } from '../components/common/SmartImage';
import { orderApi, reviewApi, type ReviewEligibility } from '../services/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { OrderDetail, OrderStatus } from '../types';

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

export function CustomerOrderDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId = '' } = useParams<{ orderId: string }>();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const [reviewEligibility, setReviewEligibility] = useState<ReviewEligibility | null>(null);
  const [reviewEligibilityError, setReviewEligibilityError] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const response = await orderApi.getMine(orderId);
      setData(response.data.data);
    } catch {
      if (!silent) setFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const completedReviewBusinessId = data?.order.order_status === 'completed'
    ? data.order.business_id
    : null;

  useEffect(() => {
    if (completedReviewBusinessId === null) {
      setReviewEligibility(null);
      setReviewEligibilityError(false);
      return;
    }
    let active = true;
    void reviewApi.eligibility(completedReviewBusinessId)
      .then((response) => {
        if (active) {
          setReviewEligibility(response.data.data);
          setReviewEligibilityError(false);
        }
      })
      .catch(() => {
        if (active) setReviewEligibilityError(true);
      });
    return () => { active = false; };
  }, [completedReviewBusinessId]);

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data || reviewRating < 1 || data.order.order_status !== 'completed') return;
    setReviewSaving(true);
    setReviewError('');
    try {
      await reviewApi.create({
        businessId: Number(data.order.business_id),
        orderId: Number(data.order.order_id),
        rating: reviewRating,
        reviewText: reviewText.trim(),
      });
      setReviewSubmitted(true);
      setReviewEligibility((current) => current
        ? { ...current, eligible: false, already_reviewed: true }
        : current);
    } catch {
      setReviewError(t('customerOrders.reviewSubmitError'));
    } finally {
      setReviewSaving(false);
    }
  };

  const cancelOrder = async () => {
    if (!data || data.order.order_status !== 'pending') return;
    if (!window.confirm(t('customerOrders.cancelConfirm'))) return;

    setCancelling(true);
    setCancelFailed(false);
    try {
      const response = await orderApi.cancelMine(data.order.order_id);
      setData((current) => current ? { ...current, order: response.data.data } : current);
    } catch {
      setCancelFailed(true);
    } finally {
      setCancelling(false);
    }
  };

  if (failed) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title={t('customerOrders.detailError')}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button type="button" variant="outline" onClick={() => void load()}>{t('common.retry')}</Button>
              <Button type="button" variant="ghost" onClick={() => navigate('/orders')}>{t('customerOrders.back')}</Button>
            </div>
          }
        />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6 lg:px-8" role="status">
        {[1, 2, 3].map((item) => <Skeleton key={item} variant="rectangular" height={100} />)}
      </div>
    );
  }

  const { order, items } = data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/orders"
        className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t('customerOrders.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-navy-500">{t('customerOrders.orderNumber', { number: order.order_number })}</p>
          <h1 className="mt-1 text-2xl font-bold text-navy-900">{t('customerOrders.detailTitle')}</h1>
          <p className="mt-1 text-sm text-navy-500">
            {t('order.placedOn', { date: formatDateTime(order.created_at) })}
          </p>
          <p className="mt-1 text-sm text-navy-600">
            {t('customerOrders.paymentStatus')}: {t(`paymentStatus.${order.payment_status}`)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[order.order_status]} size="lg">
          {t(`orderStatus.${order.order_status}`)}
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('customerOrders.items')}</h2>
            <ul className="divide-y divide-navy-100">
              {items.map((item) => (
                <li key={item.order_item_id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-navy-100">
                    <SmartImage
                      value={item.image_url}
                      alt={item.item_name}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      fallback={<div className="flex h-full items-center justify-center text-navy-400"><Package className="h-6 w-6" aria-hidden="true" /></div>}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-navy-900">{item.item_name}</h3>
                    <p className="mt-1 text-sm text-navy-500">
                      {t('customerOrders.quantityAndPrice', {
                        quantity: item.quantity,
                        price: formatCurrency(item.unit_price, order.currency),
                      })}
                    </p>
                    {item.notes && <p className="mt-1 text-sm text-navy-500">{item.notes}</p>}
                  </div>
                  <p className="shrink-0 font-semibold text-navy-900">
                    {formatCurrency(item.total_price, order.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('customerOrders.delivery')}</h2>
            {order.delivery_requested ? (
              <div className="space-y-3 text-sm text-navy-700">
                {order.delivery_address && (
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" aria-hidden="true" />
                    <span>{order.delivery_address}</span>
                  </p>
                )}
                {order.delivery_note && <p>{order.delivery_note}</p>}
                {order.delivery_latitude && order.delivery_longitude && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${order.delivery_latitude},${order.delivery_longitude}`)}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-10 items-center gap-2 text-primary-700 hover:text-primary-800"
                  >
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {t('customerOrders.deliveryLocation')}
                  </a>
                )}
                {order.customer_phone && (
                  <a href={`tel:${order.customer_phone}`} className="inline-flex min-h-10 items-center gap-2 text-primary-700">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span dir="ltr">{order.customer_phone}</span>
                  </a>
                )}
                {order.delivery_confirmation_code && (
                  <p className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                    {t('customerOrders.deliveryCode')}: <span dir="ltr" className="font-semibold tracking-[0.25em]">{order.delivery_confirmation_code}</span>
                  </p>
                )}
                {!order.delivery_confirmation_code && (
                  <div className="rounded-lg border border-navy-200 bg-navy-50 p-3">
                    <p>{t('customerOrders.deliveryCodePending')}</p>
                    <Link to="/orders" className="mt-2 inline-flex min-h-10 items-center font-medium text-primary-700">
                      {t('customerOrders.back')}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-navy-600">
                <Store className="h-4 w-4" aria-hidden="true" />
                {t('customerOrders.pickup')}
              </p>
            )}
          </Card>

          {order.order_status === 'completed' && (
            <Card className="p-5 sm:p-6">
              <h2 className="mb-2 text-lg font-semibold text-navy-900">{t('customerOrders.reviewTitle')}</h2>
              <p className="mb-4 text-sm text-navy-600">{t('customerOrders.reviewHint')}</p>
              {reviewSubmitted && (
                <p role="status" className="rounded-xl bg-success-50 p-3 text-sm text-success-600">
                  {t('customerOrders.reviewSubmitted')}
                </p>
              )}
              {reviewEligibilityError && (
                <p role="alert" className="rounded-xl bg-error-50 p-3 text-sm text-error-600">
                  {t('business.reviewEligibilityError')}
                </p>
              )}
              {reviewEligibility?.eligible && !reviewSubmitted && (
                <form onSubmit={(event) => void submitReview(event)} className="space-y-4">
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-navy-700">{t('business.yourRating')}</legend>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setReviewRating(value)}
                          aria-label={t('common.starsLabel', { count: value })}
                          aria-pressed={reviewRating === value}
                          className="rounded p-1 text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          <Star className={`h-7 w-7 ${reviewRating >= value ? 'fill-current' : ''}`} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.reviewComment')}</span>
                    <textarea
                      value={reviewText}
                      onChange={(event) => setReviewText(event.target.value)}
                      maxLength={4000}
                      rows={4}
                      className="w-full rounded-xl border border-navy-200 p-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                  {reviewError && <p role="alert" className="text-sm text-error-600">{reviewError}</p>}
                  <Button type="submit" disabled={reviewRating === 0} loading={reviewSaving}>
                    {t('business.submitReview')}
                  </Button>
                </form>
              )}
              {reviewEligibility?.already_reviewed && !reviewSubmitted && (
                <p className="rounded-xl bg-navy-50 p-3 text-sm text-navy-600">{t('business.alreadyReviewed')}</p>
              )}
              {reviewEligibility?.is_member && !reviewEligibility.already_reviewed && (
                <p className="rounded-xl bg-navy-50 p-3 text-sm text-navy-600">{t('business.reviewMemberCannotReview')}</p>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('customerOrders.summary')}</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">{t('customerOrders.subtotal')}</dt>
                <dd className="font-medium text-navy-900">{formatCurrency(order.subtotal, order.currency)}</dd>
              </div>
              {Number(order.discount_amount) > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-navy-600">{t('order.discountAmount')}</dt>
                  <dd className="font-medium text-navy-900">−{formatCurrency(order.discount_amount, order.currency)}</dd>
                </div>
              )}
              {Number(order.tax_amount) > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-navy-600">{t('order.taxAmount')}</dt>
                  <dd className="font-medium text-navy-900">{formatCurrency(order.tax_amount, order.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">{t('customerOrders.deliveryFee')}</dt>
                <dd className="font-medium text-navy-900">{formatCurrency(order.delivery_fee, order.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-navy-100 pt-3">
                <dt className="font-semibold text-navy-900">{t('customerOrders.total')}</dt>
                <dd className="font-bold text-navy-900">{formatCurrency(order.total_amount, order.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">{t('customerOrders.paymentMethod')}</dt>
                <dd className="text-end font-medium text-navy-900">
                  {order.payment_method === 'mock_mobile_money'
                    ? t('checkout.mockMobileMoney')
                    : order.payment_method === 'cash_on_delivery'
                      ? t('checkout.cashOnDelivery')
                      : order.payment_method}
                </dd>
              </div>
              {order.scheduled_for && (
                <div className="flex justify-between gap-4">
                  <dt className="text-navy-600">{t('customerOrders.scheduledFor')}</dt>
                  <dd className="text-end font-medium text-navy-900">{formatDateTime(order.scheduled_for)}</dd>
                </div>
              )}
            </dl>
            {order.order_status === 'pending' && (
              <div className="mt-5 border-t border-navy-100 pt-4">
                {cancelFailed && <p role="alert" className="mb-3 text-sm text-error-600">{t('customerOrders.cancelError')}</p>}
                <Button type="button" variant="danger" className="w-full" loading={cancelling} onClick={() => void cancelOrder()}>
                  {t('customerOrders.cancel')}
                </Button>
              </div>
            )}
          </Card>

          {order.status_history.length > 0 && (
            <Card className="p-5 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('customerOrders.tracking')}</h2>
              <ol className="space-y-4">
                {order.status_history.map((entry, index) => (
                  <li key={`${entry.status}-${entry.changed_at}-${index}`} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                    <span>
                      <span className="block font-medium text-navy-900">{t(`orderStatus.${entry.status}`)}</span>
                      <time className="mt-0.5 block text-navy-500" dateTime={entry.changed_at}>
                        {formatDateTime(entry.changed_at)}
                      </time>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
