import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, DollarSign, LogOut, MapPin, MessageCircle, Navigation, PackageCheck, Phone, RefreshCw, Truck } from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { useAuth } from '../context/useAuth';
import { courierApi, toFieldIssue } from '../services/api';
import type { AssignedCourierDelivery, CourierDeliveryList, Id } from '../types';
import { formatCurrency, formatDateTime } from '../lib/utils';

const EMPTY_DELIVERIES: CourierDeliveryList = { available: [], assigned: [], completedToday: [], dailyEarnings: [] };
const AUTO_REFRESH_SECONDS = 20;

export function CourierPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [deliveries, setDeliveries] = useState(EMPTY_DELIVERIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<Id | null>(null);
  const [confirmationCodes, setConfirmationCodes] = useState<Record<Id, string>>({});
  const [earningDrafts, setEarningDrafts] = useState<Record<Id, string>>({});
  const [secondsToRefresh, setSecondsToRefresh] = useState(AUTO_REFRESH_SECONDS);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const now = new Date();
      const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const response = await courierApi.listDeliveries(localDayStart.toISOString());
      setDeliveries(response.data.data);
      setError('');
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('courier.loadError'));
    } finally {
      setLoading(false);
      setSecondsToRefresh(AUTO_REFRESH_SECONDS);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(true), AUTO_REFRESH_SECONDS * 1000);
    const countdownTimer = window.setInterval(() => {
      setSecondsToRefresh((seconds) => seconds <= 1 ? AUTO_REFRESH_SECONDS : seconds - 1);
    }, 1000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(countdownTimer);
    };
  }, [load]);

  const claimDelivery = async (orderId: Id) => {
    const earningValue = earningDrafts[orderId]?.trim() ?? '';
    if (!/^\d+(\.\d{1,2})?$/.test(earningValue) || Number(earningValue) <= 0) {
      setError(t('courier.earningRequired'));
      return;
    }
    setBusyOrderId(orderId);
    setError('');
    try {
      await courierApi.claim(orderId, earningValue);
      setEarningDrafts((previous) => ({ ...previous, [orderId]: '' }));
      await load(true);
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('courier.actionError'));
      await load(true);
    } finally {
      setBusyOrderId(null);
    }
  };

  const changeStatus = async (delivery: AssignedCourierDelivery, nextStatus: 'picked_up' | 'on_the_way' | 'delivered') => {
    const confirmationCode = confirmationCodes[delivery.order_id] ?? '';
    if (nextStatus === 'delivered' && !/^\d{4}$/.test(confirmationCode)) {
      setError(t('courier.codeRequired'));
      return;
    }
    setBusyOrderId(delivery.order_id);
    setError('');
    try {
      await courierApi.updateStatus(delivery.order_id, nextStatus, nextStatus === 'delivered' ? confirmationCode : undefined);
      setConfirmationCodes((previous) => ({ ...previous, [delivery.order_id]: '' }));
      await load(true);
    } catch (requestError) {
      setError(toFieldIssue(requestError).message || t('courier.actionError'));
    } finally {
      setBusyOrderId(null);
    }
  };

  const statusButton = (delivery: AssignedCourierDelivery) => {
    if (delivery.delivery_status === 'assigned') {
      return (
        <Button disabled={busyOrderId === delivery.order_id} onClick={() => void changeStatus(delivery, 'picked_up')}>
          <PackageCheck className="me-2 h-4 w-4" aria-hidden="true" />
          {t('courier.markPickedUp')}
        </Button>
      );
    }
    if (delivery.delivery_status === 'picked_up') {
      return (
        <Button disabled={busyOrderId === delivery.order_id} onClick={() => void changeStatus(delivery, 'on_the_way')}>
          <Truck className="me-2 h-4 w-4" aria-hidden="true" />
          {t('courier.markOnTheWay')}
        </Button>
      );
    }
    return (
      <div className="space-y-3">
        <Input
          label={t('courier.confirmationCode')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={confirmationCodes[delivery.order_id] ?? ''}
          onChange={(event) => setConfirmationCodes((previous) => ({
            ...previous,
            [delivery.order_id]: event.target.value.replace(/\D/g, '').slice(0, 4),
          }))}
        />
        <Button disabled={busyOrderId === delivery.order_id} onClick={() => void changeStatus(delivery, 'delivered')}>
          <PackageCheck className="me-2 h-4 w-4" aria-hidden="true" />
          {t('courier.confirmDelivered')}
        </Button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-navy-50" dir={document.documentElement.dir}>
      <header className="border-b border-navy-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
              <Truck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-bold text-navy-900">OmniHQ</p>
              <p className="text-xs text-navy-500">{t('courier.portalTitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-navy-600 sm:inline">{user?.full_name}</span>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
              {t('courier.signOut')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-navy-900">{t('courier.portalTitle')}</h1>
            <p className="mt-1 text-sm text-navy-600">{t('courier.portalDescription')}</p>
          </div>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
            {t('courier.refresh')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-900">
          <span className="inline-flex items-center gap-2">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            {t('courier.autoRefresh', { seconds: secondsToRefresh })}
          </span>
          <span className="text-primary-700">
            {t('courier.dailyEarnings')}:{' '}
            <strong>
              {deliveries.dailyEarnings.length
                ? deliveries.dailyEarnings.map((earning) => formatCurrency(earning.amount, earning.currency)).join(' · ')
                : formatCurrency('0', 'USD')}
            </strong>
          </span>
        </div>

        {error && (
          <p className="rounded-button border border-error-200 bg-error-50 p-3 text-sm text-error-700" role="alert">
            {error}
          </p>
        )}

        <section aria-labelledby="completed-deliveries-title">
          <h2 id="completed-deliveries-title" className="mb-3 text-lg font-semibold text-navy-900">
            {t('courier.completedToday')} <span className="text-sm font-normal text-navy-500">({deliveries.completedToday.length})</span>
          </h2>
          {loading ? (
            <Card className="p-5 text-sm text-navy-500">{t('common.loading')}</Card>
          ) : deliveries.completedToday.length === 0 ? (
            <Card className="p-5 text-sm text-navy-500">{t('courier.completedEmpty')}</Card>
          ) : (
            <Card className="divide-y divide-navy-100 p-5">
              {deliveries.completedToday.map((delivery) => (
                <div key={delivery.order_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium text-navy-900">{delivery.business_name} · {t('courier.orderNumber', { number: delivery.order_number })}</p>
                    <p className="mt-1 text-sm text-navy-500">{formatDateTime(delivery.completed_at)}</p>
                  </div>
                  <p className="inline-flex items-center gap-1 font-semibold text-success-700">
                    <DollarSign className="h-4 w-4" aria-hidden="true" />
                    {formatCurrency(delivery.delivery_earning_amount ?? '0', delivery.currency)}
                  </p>
                </div>
              ))}
            </Card>
          )}
        </section>

        <section aria-labelledby="assigned-deliveries-title">
          <h2 id="assigned-deliveries-title" className="mb-3 text-lg font-semibold text-navy-900">
            {t('courier.assignedTitle')} <span className="text-sm font-normal text-navy-500">({deliveries.assigned.length})</span>
          </h2>
          {loading ? (
            <Card className="p-6 text-sm text-navy-500">{t('common.loading')}</Card>
          ) : deliveries.assigned.length === 0 ? (
            <Card className="p-6 text-sm text-navy-500">{t('courier.assignedEmpty')}</Card>
          ) : (
            <div className="space-y-4">
              {deliveries.assigned.map((delivery) => {
                const latitude = Number(delivery.delivery_latitude);
                const longitude = Number(delivery.delivery_longitude);
                const mapUrl = Number.isFinite(latitude) && Number.isFinite(longitude)
                  ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
                  : null;
                return (
                  <Card key={delivery.order_id} className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                          {t(`courier.status.${delivery.delivery_status}`)}
                        </p>
                        <h3 className="mt-1 text-lg font-bold text-navy-900">
                          {delivery.business_name} · {t('courier.orderNumber', { number: delivery.order_number })}
                        </h3>
                        <p className="mt-1 text-sm text-navy-500">{formatDateTime(delivery.created_at)}</p>
                      </div>
                      <div className="text-end">
                        <p className="text-xs text-navy-500">{t('courier.deliveryCharge')}</p>
                        <p className="font-semibold text-navy-900">{formatCurrency(delivery.delivery_fee, delivery.currency)}</p>
                        <p className="mt-1 text-xs text-success-700">{t('courier.agreedEarning')}: {formatCurrency(delivery.delivery_earning_amount ?? '0', delivery.currency)}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 rounded-xl bg-navy-50 p-4 text-sm sm:grid-cols-2">
                      <p><span className="font-medium text-navy-800">{t('courier.pickup')}:</span> {delivery.pickup_address || delivery.city || '—'}</p>
                      <p><span className="font-medium text-navy-800">{t('courier.dropoffNote')}:</span> {delivery.delivery_note || '—'}</p>
                      {mapUrl && (
                        <a className="inline-flex min-h-10 items-center gap-2 font-medium text-primary-700" href={mapUrl} target="_blank" rel="noreferrer">
                          <Navigation className="h-4 w-4" aria-hidden="true" /> {t('courier.openDirections')}
                        </a>
                      )}
                      <p className="inline-flex items-center gap-2 text-navy-600">
                        <MapPin className="h-4 w-4" aria-hidden="true" /> {t('courier.locationShared')}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {delivery.customer_phone && (
                        <>
                          <a className="inline-flex min-h-10 items-center gap-2 rounded-button border border-navy-300 px-3 text-sm font-medium text-navy-800 hover:bg-navy-50" href={`tel:${delivery.customer_phone}`}>
                            <Phone className="h-4 w-4" aria-hidden="true" /> {t('courier.callCustomer')}
                          </a>
                          <a
                            className="inline-flex min-h-10 items-center gap-2 rounded-button border border-success-300 px-3 text-sm font-medium text-success-800 hover:bg-success-50"
                            href={`https://wa.me/${delivery.customer_phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MessageCircle className="h-4 w-4" aria-hidden="true" /> {t('courier.whatsappCustomer')}
                          </a>
                        </>
                      )}
                      {delivery.business_phone && (
                        <a className="inline-flex min-h-10 items-center gap-2 rounded-button border border-navy-300 px-3 text-sm font-medium text-navy-800 hover:bg-navy-50" href={`tel:${delivery.business_phone}`}>
                          <Phone className="h-4 w-4" aria-hidden="true" /> {t('courier.callBusiness')}
                        </a>
                      )}
                      {delivery.business_whatsapp && (
                        <a
                          className="inline-flex min-h-10 items-center gap-2 rounded-button border border-success-300 px-3 text-sm font-medium text-success-800 hover:bg-success-50"
                          href={`https://wa.me/${delivery.business_whatsapp.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" /> {t('courier.whatsappBusiness')}
                        </a>
                      )}
                    </div>
                    <div className="mt-4">{statusButton(delivery)}</div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="available-deliveries-title">
          <h2 id="available-deliveries-title" className="mb-3 text-lg font-semibold text-navy-900">
            {t('courier.availableTitle')} <span className="text-sm font-normal text-navy-500">({deliveries.available.length})</span>
          </h2>
          {loading ? (
            <Card className="p-6 text-sm text-navy-500">{t('common.loading')}</Card>
          ) : deliveries.available.length === 0 ? (
            <Card className="p-6 text-sm text-navy-500">{t('courier.availableEmpty')}</Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {deliveries.available.map((delivery) => (
                <Card key={delivery.order_id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-navy-900">{delivery.business_name}</h3>
                      <p className="mt-1 text-sm text-navy-500">{t('courier.orderNumber', { number: delivery.order_number })}</p>
                      <p className="mt-1 text-sm text-navy-500">{delivery.city || '—'} · {formatDateTime(delivery.created_at)}</p>
                    </div>
                    <p className="whitespace-nowrap font-semibold text-navy-900">{formatCurrency(delivery.delivery_fee, delivery.currency)}</p>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Input
                      label={t('courier.proposedEarning')}
                      type="number"
                      min="0.01"
                      max="100000"
                      step="0.01"
                      value={earningDrafts[delivery.order_id] ?? ''}
                      onChange={(event) => setEarningDrafts((previous) => ({
                        ...previous,
                        [delivery.order_id]: event.target.value,
                      }))}
                    />
                    <p className="pb-2 text-xs text-navy-500">{t('courier.negotiateDirectly')}</p>
                  </div>
                  <Button className="mt-4 w-full" disabled={busyOrderId === delivery.order_id} onClick={() => void claimDelivery(delivery.order_id)}>
                    {t('courier.acceptDelivery')}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
