import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Package, Smartphone, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { SmartImage } from '../components/common/SmartImage';
import { DeliveryLocationPicker } from '../components/business/DeliveryLocationPicker';
import { orderApi, paymentApi, toFieldIssue, type PaymentMethodOption, type PaymentProviderName } from '../services/api';
import { buildCheckoutOrderInput, estimateCheckoutTotal, isCheckoutDraft } from '../lib/checkout';
import { formatCurrency, formatDateTime } from '../lib/utils';

export function CheckoutPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const draft = isCheckoutDraft(location.state) ? location.state : null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentProviderName | null>(null);
  const [deliveryRequested, setDeliveryRequested] = useState(draft?.deliveryRequested ?? false);
  const [locationConsent, setLocationConsent] = useState(draft?.locationConsent ?? false);
  const [deliveryLatitude, setDeliveryLatitude] = useState<number | null>(draft?.deliveryLatitude ?? null);
  const [deliveryLongitude, setDeliveryLongitude] = useState<number | null>(draft?.deliveryLongitude ?? null);
  const [deliveryNote, setDeliveryNote] = useState(draft?.deliveryNote ?? '');
  const [customerPhone, setCustomerPhone] = useState(draft?.customerPhone ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(draft?.deliveryAddress ?? '');
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [city, setCity] = useState('');
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(t('business.deliveryGeolocationUnavailable'));
      return;
    }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Number(coords.latitude.toFixed(4));
        const lng = Number(coords.longitude.toFixed(4));
        setDeliveryLatitude(Number(coords.latitude.toFixed(6)));
        setDeliveryLongitude(Number(coords.longitude.toFixed(6)));
        setDeliveryAddress(`GPS Location: (${lat}, ${lng})`);
        setLocating(false);
      },
      () => {
        setLocationError(t('business.deliveryGeolocationError'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    let active = true;
    paymentApi.methods()
      .then((response) => {
        if (active) {
          const available = response.data.data.filter((method) => method.available);
          setPaymentMethods(available);
          setPaymentMethod(available[0]?.name ?? null);
        }
      })
      .catch(() => {
        if (active) setError(t('checkout.methodsError'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  if (!draft) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title={t('checkout.missingTitle')}
          description={t('checkout.missingDescription')}
          action={<Button type="button" onClick={() => navigate('/explore')}>{t('customerOrders.browse')}</Button>}
        />
      </div>
    );
  }

  const hasDeliverableProducts = Boolean(draft.deliveryEnabled && draft.items.some((item) => item.productId));
  const checkoutDraft = {
    ...draft,
    deliveryRequested: hasDeliverableProducts && deliveryRequested,
    locationConsent,
    ...(deliveryLatitude === null ? {} : { deliveryLatitude }),
    ...(deliveryLongitude === null ? {} : { deliveryLongitude }),
    deliveryNote,
    customerPhone,
    deliveryAddress,
    fulfillmentType,
    city,
  };
  const subtotal = checkoutDraft.items.reduce((amount, item) => amount + Number(item.unitPrice) * item.quantity, 0);
  const deliveryFee = checkoutDraft.deliveryRequested ? Number(checkoutDraft.deliveryFee ?? 0) : 0;
  const total = estimateCheckoutTotal(checkoutDraft);

  const submitOrder = async () => {
    if (!paymentMethod || !paymentMethods.some((method) => method.name === paymentMethod)) {
      setError(t('checkout.noPaymentMethods'));
      return;
    }
    if (fulfillmentType === 'delivery' && (
      checkoutDraft.deliveryRequested
      && (!locationConsent || deliveryLatitude === null || deliveryLongitude === null || customerPhone.trim().length < 7 || deliveryAddress.trim().length < 3)
    )) {
      setError(t('business.deliveryFieldsRequired'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await orderApi.create(buildCheckoutOrderInput(
        checkoutDraft,
        paymentMethod,
        i18n.resolvedLanguage ?? i18n.language,
      ));
      const payment = await paymentApi.start(response.data.data.order_id, paymentMethod);
      if (paymentMethod === 'mock_mobile_money') {
        await paymentApi.completeMock(payment.data.data.payment_id);
      }
      navigate(`/orders/${response.data.data.order_id}`, { replace: true });
    } catch (submitError) {
      const issue = toFieldIssue(submitError);
      setError(issue.message || t('checkout.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/business/${draft.businessSlug}`}
        className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t('checkout.backToBusiness')}
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">{t('checkout.title')}</h1>
        <p className="mt-1 text-sm text-navy-500">{t('checkout.subtitle')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('checkout.orderSummary')}</h2>
            <p className="mb-4 flex items-center gap-2 text-sm font-medium text-navy-700">
              <Store className="h-4 w-4 text-navy-400" aria-hidden="true" />
              {draft.businessName}
            </p>
            <ul className="divide-y divide-navy-100">
              {draft.items.map((item, index) => (
                <li key={`${item.productId ?? item.serviceId}-${index}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-navy-100">
                    <SmartImage
                      value={item.imageUrl}
                      alt={item.itemName}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      fallback={<div className="flex h-full items-center justify-center text-navy-400"><Package className="h-6 w-6" aria-hidden="true" /></div>}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-navy-900">{item.itemName}</h3>
                    <p className="mt-1 text-sm text-navy-500">
                      {t('customerOrders.quantityAndPrice', {
                        quantity: item.quantity,
                        price: formatCurrency(item.unitPrice, draft.currency),
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold text-navy-900">
                    {formatCurrency(Number(item.unitPrice) * item.quantity, draft.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 text-lg font-semibold text-navy-900">{t('checkout.fulfillmentMethod')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['delivery', 'pickup'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setFulfillmentType(mode);
                    setError('');
                  }}
                  className={`flex min-h-14 items-center justify-center gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                    fulfillmentType === mode
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-navy-200 hover:border-navy-300'
                  }`}
                >
                  <span className="font-medium text-navy-900">{t(`checkout.fulfillmentMode.${mode}`)}</span>
                </button>
              ))}
            </div>
          </Card>

          {fulfillmentType === 'delivery' && hasDeliverableProducts && (
            <Card className="p-5 sm:p-6">
              <fieldset>
                <legend className="mb-3 text-lg font-semibold text-navy-900">{t('business.deliveryQuestion')}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['pickup', 'delivery'] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-4 ${
                        checkoutDraft.deliveryRequested === (mode === 'delivery')
                          ? 'border-primary-300 bg-primary-50'
                          : 'border-navy-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="deliveryMode"
                        checked={checkoutDraft.deliveryRequested === (mode === 'delivery')}
                        onChange={() => {
                          setDeliveryRequested(mode === 'delivery');
                          setError('');
                        }}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <span className="font-medium text-navy-900">{t(`business.deliveryMode.${mode}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {checkoutDraft.deliveryRequested && (
                <div className="mt-5 space-y-4">
                  <p className="text-sm text-navy-600">
                    {t('business.deliveryFeeBeforeOrder', {
                      fee: formatCurrency(draft.deliveryFee ?? '0', draft.currency),
                    })}
                  </p>
                  <p className="text-sm font-medium text-navy-800">{t('business.deliveryMapHint')}</p>
                  <Button type="button" variant="outline" size="sm" loading={locating} onClick={handleGetLocation}>
                    {t('business.useCurrentLocation')}
                  </Button>
                  <DeliveryLocationPicker
                    latitude={deliveryLatitude}
                    longitude={deliveryLongitude}
                    centerLatitude={draft.businessLatitude ?? null}
                    centerLongitude={draft.businessLongitude ?? null}
                    onChange={(latitude, longitude) => {
                      setDeliveryLatitude(latitude);
                      setDeliveryLongitude(longitude);
                    }}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.city')}</span>
                      <input
                        type="text"
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        minLength={2}
                        maxLength={100}
                        className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.deliveryPhone')}</span>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.target.value)}
                        minLength={7}
                        maxLength={20}
                        autoComplete="tel"
                        className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.deliveryAddress')}</span>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={(event) => setDeliveryAddress(event.target.value)}
                      minLength={3}
                      maxLength={500}
                      autoComplete="street-address"
                      className="min-h-11 w-full rounded-xl border border-navy-200 px-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-navy-700">{t('business.deliveryLandmark')}</span>
                    <textarea
                      value={deliveryNote}
                      onChange={(event) => setDeliveryNote(event.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-xl border border-navy-200 p-3 text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-sm text-navy-700">
                    <input
                      type="checkbox"
                      checked={locationConsent}
                      onChange={(event) => setLocationConsent(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded accent-primary-600"
                    />
                    <span>{t('business.deliveryConsent')}</span>
                  </label>
                  {locationError && <p role="alert" className="text-sm text-error-600">{locationError}</p>}
                </div>
              )}
            </Card>
          )}

          {fulfillmentType === 'pickup' && (
            <Card className="p-5 sm:p-6">
              <p className="text-sm text-navy-600">{t('checkout.pickupInfo')}</p>
            </Card>
          )}

          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('checkout.paymentMethod')}</h2>
            {paymentMethods.length === 0 && (
              <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="status">
                {t('checkout.noPaymentMethods')}
              </p>
            )}
            {paymentMethods.map((method) => (
              <label
                key={method.name}
                className={`mb-3 flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-4 ${
                  paymentMethod === method.name ? 'border-primary-300 bg-primary-50' : 'border-navy-200'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method.name}
                  checked={paymentMethod === method.name}
                  onChange={() => setPaymentMethod(method.name)}
                  className="h-4 w-4 accent-primary-600"
                />
                <Smartphone className="h-5 w-5 text-primary-700" aria-hidden="true" />
                <span>
                  <span className="block font-semibold text-navy-900">
                    {`${t('checkout.mockMobileMoney')} (${t('checkout.testOnly')})`}
                  </span>
                  <span className="mt-0.5 block text-sm text-navy-600">
                    {t('checkout.mockMobileMoneyDescription')}
                  </span>
                </span>
              </label>
            ))}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-navy-900">{t('checkout.estimatedTotal')}</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">{t('checkout.subtotal')}</dt>
                <dd className="font-medium text-navy-900">{formatCurrency(subtotal, draft.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">{t('customerOrders.deliveryFee')}</dt>
                <dd className="font-medium text-navy-900">{formatCurrency(deliveryFee, draft.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-navy-100 pt-3">
                <dt className="font-semibold text-navy-900">{t('checkout.estimatedTotal')}</dt>
                <dd className="font-bold text-navy-900">{formatCurrency(total, draft.currency)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-navy-500">{t('checkout.totalHint')}</p>
            {checkoutDraft.deliveryRequested && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-sm text-navy-700">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('checkout.deliveryIncluded')}
              </p>
            )}
            {draft.scheduledFor && (
              <p className="mt-4 text-sm text-navy-600">
                {t('customerOrders.scheduledFor')}: {formatDateTime(draft.scheduledFor)}
              </p>
            )}
            {error && <p className="mt-4 text-sm text-error-600" role="alert">{error}</p>}
            <Button
              type="button"
              className="mt-5 w-full"
              loading={submitting}
              disabled={!paymentMethod || paymentMethods.length === 0}
              onClick={() => void submitOrder()}
            >
              {t('checkout.confirmOrder')}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
