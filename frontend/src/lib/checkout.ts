import type { CheckoutDraft } from '../types';
import type { NotificationLanguage, PaymentProviderName } from '../types';

export function isCheckoutDraft(value: unknown): value is CheckoutDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CheckoutDraft>;
  return (
    typeof candidate.businessId === 'number' &&
    Number.isSafeInteger(candidate.businessId) &&
    candidate.businessId > 0 &&
    typeof candidate.businessName === 'string' &&
    candidate.businessName.length > 0 &&
    typeof candidate.businessSlug === 'string' &&
    candidate.businessSlug.length > 0 &&
    typeof candidate.currency === 'string' &&
    /^[A-Z]{3}$/i.test(candidate.currency) &&
    Array.isArray(candidate.items) &&
    candidate.items.length > 0 &&
    candidate.items.every((item) =>
      item &&
      typeof item.itemName === 'string' &&
      item.itemName.length > 0 &&
      typeof item.quantity === 'number' &&
      Number.isSafeInteger(item.quantity) &&
      item.quantity > 0 &&
      typeof item.unitPrice === 'string' &&
      Number.isFinite(Number(item.unitPrice)) &&
      Number(item.unitPrice) >= 0 &&
      ((Number.isSafeInteger(item.productId) && item.productId! > 0) !==
        (Number.isSafeInteger(item.serviceId) && item.serviceId! > 0)),
    ) &&
    typeof candidate.deliveryRequested === 'boolean' &&
    typeof candidate.locationConsent === 'boolean' &&
    (!candidate.deliveryRequested ||
      (candidate.locationConsent === true &&
        typeof candidate.deliveryLatitude === 'number' &&
        Number.isFinite(candidate.deliveryLatitude) &&
        candidate.deliveryLatitude >= -90 &&
        candidate.deliveryLatitude <= 90 &&
        typeof candidate.deliveryLongitude === 'number' &&
        Number.isFinite(candidate.deliveryLongitude) &&
        candidate.deliveryLongitude >= -180 &&
        candidate.deliveryLongitude <= 180 &&
        typeof candidate.customerPhone === 'string' &&
        candidate.customerPhone.trim().length >= 7 &&
        typeof candidate.deliveryAddress === 'string' &&
        candidate.deliveryAddress.trim().length >= 3)) &&
    (candidate.deliveryFee === undefined ||
      (typeof candidate.deliveryFee === 'string' &&
        Number.isFinite(Number(candidate.deliveryFee)) &&
        Number(candidate.deliveryFee) >= 0))
  );
}

export function buildCheckoutOrderInput(
  draft: CheckoutDraft,
  paymentMethod: PaymentProviderName,
  language = 'en',
) {
  const notificationLanguage: NotificationLanguage =
    language === 'ar' || language === 'so' ? language : 'en';
  return {
    businessId: draft.businessId,
    items: draft.items.map(({ productId, serviceId, quantity }) => ({
      ...(productId ? { productId } : {}),
      ...(serviceId ? { serviceId } : {}),
      quantity,
    })),
    ...(draft.scheduledFor ? { scheduledFor: draft.scheduledFor } : {}),
    deliveryRequested: draft.deliveryRequested,
    locationConsent: draft.locationConsent,
    ...(draft.deliveryRequested ? {
      deliveryLatitude: draft.deliveryLatitude,
      deliveryLongitude: draft.deliveryLongitude,
      deliveryNote: draft.deliveryNote,
      customerPhone: draft.customerPhone,
      deliveryAddress: draft.deliveryAddress,
    } : {}),
    paymentMethod,
    notificationLanguage,
  };
}

export function estimateCheckoutTotal(draft: CheckoutDraft): number {
  const subtotal = draft.items.reduce((total, item) => total + Number(item.unitPrice) * item.quantity, 0);
  return subtotal + (draft.deliveryRequested ? Number(draft.deliveryFee ?? 0) : 0);
}
