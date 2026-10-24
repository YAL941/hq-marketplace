import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Activity, BadgeCheck, Bell, Boxes, Check, PackagePlus, Pencil, Plus, RefreshCw, Send, Store, Truck, X } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { inAppNotificationApi, locationApi, productApi, toFieldIssue, wholesaleApi } from '../services/api';
import type {
  Id, InAppNotification, InAppNotificationPage, Location, Product, WholesaleDashboardData,
  WholesaleOffer, WholesalePurchaseOrder, WholesaleReceiptAttempt,
} from '../types';

const EMPTY_DASHBOARD: WholesaleDashboardData = {
  supplier: null,
  canManageWholesale: false,
  canManageInventory: false,
  offers: [],
  rfqs: [],
  purchaseOrders: [],
  events: [],
  stats: { incoming_orders: 0, placed_orders: 0, supplier_sales_by_currency: {} },
};

const EMPTY_NOTIFICATIONS: InAppNotificationPage = {
  notifications: [],
  unreadCount: 0,
  limit: 10,
  offset: 0,
  total: 0,
  hasMore: false,
};

const notificationMessageKeys: Record<string, string> = {
  'wholesale.purchase_order.created': 'notifications.events.purchaseOrderCreated',
  'wholesale.purchase_order.status_changed': 'notifications.events.purchaseOrderStatusChanged',
  'wholesale.rfq.created': 'notifications.events.rfqCreated',
  'wholesale.rfq.quoted': 'notifications.events.rfqQuoted',
  'wholesale.rfq.decided': 'notifications.events.rfqDecided',
  'wholesale.receipt.recorded': 'notifications.events.receiptRecorded',
};
const notificationOrderStatuses = new Set([
  'pending_confirmation', 'confirmed', 'processing', 'shipped', 'partially_delivered', 'delivered', 'cancelled',
]);
const notificationRfqDecisions = new Set(['accepted', 'rejected', 'cancelled']);

function notificationLink(businessId: Id, notification: InAppNotification): string | null {
  const targetId = Number(notification.target_id);
  if (!Number.isSafeInteger(targetId) || targetId < 1) return null;
  const section = notification.target_type === 'purchase_order' ? 'purchase-orders'
    : notification.target_type === 'rfq' ? 'rfqs' : null;
  if (!section) return null;
  return `/dashboard/business/${encodeURIComponent(businessId)}/wholesale#${section}-${targetId}`;
}

interface OfferTierDraft {
  minimumQuantity: string;
  maximumQuantity: string;
  unitPrice: string;
}

interface PendingReceiptAttempt {
  idempotencyKey: string;
  quantity: number;
  locationId: number;
}

function receiptAttemptKey(businessId: Id, orderId: Id, itemId: Id): string {
  return `hq-wholesale-receipt:${businessId}:${orderId}:${itemId}`;
}

function isPendingReceiptAttempt(value: unknown): value is PendingReceiptAttempt {
  if (typeof value !== 'object' || value === null) return false;
  return 'idempotencyKey' in value && typeof value.idempotencyKey === 'string'
    && value.idempotencyKey.length >= 8
    && 'quantity' in value && typeof value.quantity === 'number'
    && Number.isSafeInteger(value.quantity) && value.quantity > 0
    && 'locationId' in value && typeof value.locationId === 'number'
    && Number.isSafeInteger(value.locationId) && value.locationId > 0;
}

function getPendingReceiptAttempt(key: string, invalidDataMessage: string): PendingReceiptAttempt | null {
  const serialized = localStorage.getItem(key);
  if (serialized === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(invalidDataMessage);
  }
  if (!isPendingReceiptAttempt(value)) throw new Error(invalidDataMessage);
  return value;
}

function matchesReceiptAttempt(
  attempt: WholesaleReceiptAttempt,
  itemId: Id,
  quantity: number,
  locationId: number,
): boolean {
  const result = attempt.result;
  if (attempt.state !== 'completed' || !result || Number(result.location_id) !== locationId
    || (result.note !== null && result.note !== undefined && result.note !== '')) return false;
  const items = result.items;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const [item] = items as Array<Record<string, unknown>>;
  return Number(item?.purchase_order_item_id) === Number(itemId)
    && Number(item?.received_quantity) === quantity;
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function money(value: string | number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
}

export function DashboardWholesalePage() {
  const { t, i18n } = useTranslation();
  const { businessId = '' } = useParams<{ businessId: Id }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const linkedProductId = searchParams.get('productId') ?? '';
  const requestedQuantity = searchParams.get('quantity') ?? '';
  const linkedLocationId = searchParams.get('locationId') ?? '';
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [offers, setOffers] = useState<WholesaleOffer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [receiptStorageAvailable, setReceiptStorageAvailable] = useState(true);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [applicationNote, setApplicationNote] = useState('');
  const [editingOfferId, setEditingOfferId] = useState<Id | null>(null);
  const [offerDraft, setOfferDraft] = useState({
    productId: '',
    wholesalePrice: '',
    minimumOrderQuantity: '1',
    availableQuantity: '0',
  });
  const [offerTiers, setOfferTiers] = useState<OfferTierDraft[]>([]);
  const [buyerProducts, setBuyerProducts] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quotePrices, setQuotePrices] = useState<Record<string, Record<string, string>>>({});
  const [quoteValidUntil, setQuoteValidUntil] = useState<Record<string, string>>({});
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, Record<string, string>>>({});
  const [receiptAttempts, setReceiptAttempts] = useState<Record<string, WholesaleReceiptAttempt[]>>({});
  const [notifications, setNotifications] = useState(EMPTY_NOTIFICATIONS);
  const [notificationError, setNotificationError] = useState('');
  const [deliveryLocationId, setDeliveryLocationId] = useState('');
  const notificationRefreshRef = useRef<{ businessId: Id; promise: Promise<void> } | null>(null);
  const activeBusinessIdRef = useRef(businessId);
  activeBusinessIdRef.current = businessId;

  const refreshNotifications = useCallback(async () => {
    if (!businessId) return;
    if (notificationRefreshRef.current?.businessId === businessId) {
      await notificationRefreshRef.current.promise;
      return;
    }
    const refresh = inAppNotificationApi.list(businessId, { limit: 10, offset: 0 })
      .then((response) => {
        if (activeBusinessIdRef.current !== businessId) return;
        setNotifications(response.data.data);
        setNotificationError('');
      })
      .catch((requestError: unknown) => {
        if (activeBusinessIdRef.current !== businessId) return;
        const issue = toFieldIssue(requestError);
        setNotificationError(issue.message || t('notifications.loadError'));
      })
      .finally(() => {
        if (notificationRefreshRef.current?.promise === refresh) notificationRefreshRef.current = null;
      });
    notificationRefreshRef.current = { businessId, promise: refresh };
    await refresh;
  }, [businessId, t]);

  const load = useCallback(async (silent = false) => {
    if (!businessId) return;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [dashboardResponse, offerResponse, productResponse, locationResponse] = await Promise.all([
        wholesaleApi.dashboard(businessId),
        wholesaleApi.offers({ search: search.trim() || undefined, limit: 100 }),
        productApi.listForBusiness(businessId, { status: 'active', limit: 100 }),
        locationApi.listForBusiness(businessId),
      ]);
      const nextDashboard = dashboardResponse.data.data;
      setDashboard(nextDashboard);
      setPermissionDenied(false);
      setError('');
      setOffers(offerResponse.data.data);
      setProducts(productResponse.data.data.filter((product) => product.is_stock_tracked));
      const activeLocations = locationResponse.data.data.filter((location) => location.is_active);
      setLocations(activeLocations);
      await refreshNotifications();
      const attemptLists = nextDashboard.canManageInventory && nextDashboard.canManageWholesale
        ? await Promise.all(nextDashboard.purchaseOrders
          .filter((order) => order.buyer_business_id === businessId)
          .map(async (order) => ({
            orderId: order.purchase_order_id,
            attempts: (await wholesaleApi.receiptAttempts(businessId, order.purchase_order_id)).data.data,
          })))
        : [];
      setReceiptAttempts(Object.fromEntries(attemptLists.map(({ orderId, attempts }) => [orderId, attempts])));
      const preferredLocation = activeLocations.find((location) => location.location_id === linkedLocationId)
        ?? activeLocations.find((location) => location.is_primary)
        ?? activeLocations[0];
      setBuyerProducts((current) => {
        const next = { ...current };
        for (const offer of offerResponse.data.data) {
          if (!next[offer.offer_id]) {
            const linkedProduct = productResponse.data.data.find((product) => product.product_id === linkedProductId);
            const defaultProduct = linkedProduct ?? productResponse.data.data[0];
            if (defaultProduct) next[offer.offer_id] = defaultProduct.product_id;
          }
        }
        return next;
      });
      if (requestedQuantity) {
        setQuantities((current) => {
          const next = { ...current };
          for (const offer of offerResponse.data.data) {
            if (!next[offer.offer_id]) {
              next[offer.offer_id] = String(Math.min(
                Math.max(Number(requestedQuantity), offer.minimum_order_quantity),
                offer.available_quantity,
              ));
            }
          }
          return next;
        });
      }
      const savedReceiptQuantities: Record<string, Record<string, string>> = {};
      const pendingReceiptItems: Record<string, Set<string>> = {};
      let pendingLocationId: number | undefined;
      for (const order of nextDashboard.purchaseOrders) {
        savedReceiptQuantities[order.purchase_order_id] = {};
        pendingReceiptItems[order.purchase_order_id] = new Set();
        for (const item of order.items) {
          let pending: PendingReceiptAttempt | null = null;
          try {
            pending = getPendingReceiptAttempt(receiptAttemptKey(
              businessId, order.purchase_order_id, item.purchase_order_item_id,
            ), t('wholesale.receiptRetryStorageError'));
          } catch {
            setReceiptStorageAvailable(false);
          }
          if (pending) {
            savedReceiptQuantities[order.purchase_order_id]![item.purchase_order_item_id] = String(pending.quantity);
            pendingReceiptItems[order.purchase_order_id]!.add(item.purchase_order_item_id);
            pendingLocationId ??= pending.locationId;
          } else {
            savedReceiptQuantities[order.purchase_order_id]![item.purchase_order_item_id] = String(
              Math.max(0, item.ordered_quantity - item.received_quantity),
            );
          }
        }
      }
      setDeliveryLocationId((currentLocation) => pendingLocationId
        ? String(pendingLocationId)
        : currentLocation || String(preferredLocation?.location_id ?? ''));
      setReceiptQuantities((current) => {
        const next = { ...current };
        for (const order of nextDashboard.purchaseOrders) {
          const saved = savedReceiptQuantities[order.purchase_order_id] ?? {};
          const existing = { ...next[order.purchase_order_id] };
          const pendingItems = pendingReceiptItems[order.purchase_order_id] ?? new Set<string>();
          for (const item of order.items) {
            if (pendingItems.has(item.purchase_order_item_id)) existing[item.purchase_order_item_id] = saved[item.purchase_order_item_id]!;
            else existing[item.purchase_order_item_id] ??= saved[item.purchase_order_item_id]!;
          }
          next[order.purchase_order_id] = existing;
        }
        return next;
      });
    } catch (requestError) {
      const issue = toFieldIssue(requestError);
      setPermissionDenied(issue.status === 403);
      setError(issue.message || t('wholesale.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [businessId, linkedLocationId, linkedProductId, refreshNotifications, requestedQuantity, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setNotifications(EMPTY_NOTIFICATIONS);
    setNotificationError('');
  }, [businessId]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const refreshNotificationsWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    const interval = window.setInterval(refreshNotificationsWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [load, refreshNotifications]);

  useEffect(() => {
    if (!loading && location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    }
  }, [dashboard.purchaseOrders, dashboard.rfqs, loading, location.hash]);

  const visibleOffers = useMemo(() => offers.filter((offer) =>
    offer.status === 'active' && offer.supplier_business_id !== businessId), [businessId, offers]);
  const supplierApproved = dashboard.supplier?.status === 'approved';
  const supplierPending = dashboard.supplier?.status === 'pending';
  const supplierOffers = dashboard.offers;
  const pendingSupplierRfqs = dashboard.rfqs.filter((rfq) =>
    rfq.supplier_business_id === businessId && rfq.status === 'pending');
  const buyerQuotesAwaitingAction = dashboard.rfqs.filter((rfq) =>
    rfq.buyer_business_id === businessId && rfq.status === 'quoted');
  const supplierOpenOrders = dashboard.purchaseOrders.filter((order) =>
    order.supplier_business_id === businessId
    && !['delivered', 'cancelled'].includes(order.status));
  const supplierOrdersAwaitingFulfillment = supplierOpenOrders.filter((order) =>
    ['confirmed', 'processing'].includes(order.status));

  const runAction = async (key: string, action: () => Promise<unknown>, message?: string): Promise<boolean> => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      if (message) setNotice(message);
      await load(true);
      return true;
    } catch (requestError) {
      const issue = toFieldIssue(requestError);
      setError(issue.message || t('wholesale.saveError'));
      return false;
    } finally {
      setBusy('');
    }
  };

  const markNotificationRead = async (notification: InAppNotification) => {
    if (notification.read_at) return;
    try {
      const response = await inAppNotificationApi.markRead(businessId, notification.notification_id);
      if (activeBusinessIdRef.current !== businessId) return;
      setNotifications((current) => ({
        ...current,
        notifications: current.notifications.map((item) => {
          if (item.notification_id !== notification.notification_id) return item;
          if (item.read_at) return item;
          return response.data.data;
        }),
        unreadCount: current.notifications.some((item) =>
          item.notification_id === notification.notification_id && item.read_at === null)
          ? Math.max(0, current.unreadCount - 1)
          : current.unreadCount,
      }));
      setNotificationError('');
    } catch (requestError) {
      if (activeBusinessIdRef.current !== businessId) return;
      const issue = toFieldIssue(requestError);
      setNotificationError(issue.message || t('notifications.loadError'));
    }
  };

  const loadMoreNotifications = async () => {
    try {
      const response = await inAppNotificationApi.list(businessId, {
        limit: notifications.limit,
        offset: notifications.notifications.length,
      });
      if (activeBusinessIdRef.current !== businessId) return;
      setNotifications((current) => ({
        ...response.data.data,
        notifications: [...current.notifications, ...response.data.data.notifications],
      }));
      setNotificationError('');
    } catch (requestError) {
      if (activeBusinessIdRef.current !== businessId) return;
      const issue = toFieldIssue(requestError);
      setNotificationError(issue.message || t('notifications.loadError'));
    }
  };

  const submitApplication = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('application', () => wholesaleApi.applySupplier(businessId, applicationNote.trim()), t('wholesale.applicationSent'));
  };

  const resetOfferDraft = () => {
    setEditingOfferId(null);
    setOfferDraft({
      productId: '',
      wholesalePrice: '',
      minimumOrderQuantity: '1',
      availableQuantity: '0',
    });
    setOfferTiers([]);
  };

  const editOffer = (offer: WholesaleOffer) => {
    setEditingOfferId(offer.offer_id);
    setOfferDraft({
      productId: offer.product_id,
      wholesalePrice: offer.wholesale_price,
      minimumOrderQuantity: String(offer.minimum_order_quantity),
      availableQuantity: String(offer.available_quantity),
    });
    setOfferTiers(offer.tiers.map((tier) => ({
      minimumQuantity: String(tier.minimum_quantity),
      maximumQuantity: tier.maximum_quantity == null ? '' : String(tier.maximum_quantity),
      unitPrice: tier.unit_price,
    })));
  };

  const submitOffer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = products.find((product) => product.product_id === offerDraft.productId);
    if (!selected) {
      setError(t('wholesale.selectProduct'));
      return;
    }
    const minimumOrderQuantity = Number(offerDraft.minimumOrderQuantity);
    const availableQuantity = Number(offerDraft.availableQuantity);
    const wholesalePrice = Number(offerDraft.wholesalePrice);
    if (!Number.isSafeInteger(minimumOrderQuantity) || minimumOrderQuantity < 1
      || !Number.isSafeInteger(availableQuantity) || availableQuantity < 0
      || !Number.isFinite(wholesalePrice) || wholesalePrice <= 0
      || wholesalePrice > 99_999_999_999.99
      || Math.abs(wholesalePrice * 100 - Math.round(wholesalePrice * 100)) >= 1e-8) {
      setError(t('wholesale.invalidOffer'));
      return;
    }
    if (offerTiers.length > 50 || offerTiers.some((tier) => !tier.minimumQuantity || !tier.unitPrice)) {
      setError(t('wholesale.completeTier'));
      return;
    }
    let previousMaximum: number | null = null;
    for (let index = 0; index < offerTiers.length; index += 1) {
      const tier = offerTiers[index]!;
      const minimumQuantity = Number(tier.minimumQuantity);
      const maximumQuantity = tier.maximumQuantity ? Number(tier.maximumQuantity) : null;
      const unitPrice = Number(tier.unitPrice);
      if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < minimumOrderQuantity
        || (maximumQuantity != null && (!Number.isSafeInteger(maximumQuantity) || maximumQuantity < minimumQuantity))
        || !Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 99_999_999_999.99
        || Math.abs(unitPrice * 100 - Math.round(unitPrice * 100)) >= 1e-8
        || (index > 0 && previousMaximum === null)
        || (previousMaximum !== null && minimumQuantity <= previousMaximum)) {
        setError(t('wholesale.invalidTiers'));
        return;
      }
      previousMaximum = maximumQuantity;
    }
    const tiers = offerTiers.map((tier) => ({
      minimumQuantity: Number(tier.minimumQuantity),
      maximumQuantity: tier.maximumQuantity ? Number(tier.maximumQuantity) : null,
      unitPrice: Number(tier.unitPrice),
    }));
    const data = {
      productId: Number(selected.product_id),
      wholesalePrice,
      currency: selected.currency,
      minimumOrderQuantity,
      availableQuantity,
      tiers,
    };
    void runAction('offer', () => editingOfferId
      ? wholesaleApi.updateOffer(businessId, editingOfferId, { ...data, status: supplierOffers.find((offer) => offer.offer_id === editingOfferId)?.status ?? 'active' })
      : wholesaleApi.saveOffer(businessId, data), editingOfferId ? t('wholesale.offerUpdated') : t('wholesale.offerSaved'))
      .then((saved) => { if (saved) resetOfferDraft(); });
  };

  const requestQuote = (offer: WholesaleOffer) => {
    const buyerProductId = buyerProducts[offer.offer_id];
    const quantity = Number(quantities[offer.offer_id] ?? offer.minimum_order_quantity);
    if (!buyerProductId || !Number.isSafeInteger(quantity)
      || quantity < offer.minimum_order_quantity || quantity > offer.available_quantity) {
      setError(t('wholesale.completeRfq'));
      return;
    }
    void runAction(`rfq-${offer.offer_id}`, () => wholesaleApi.createRfq(businessId, {
      supplierBusinessId: Number(offer.supplier_business_id),
      items: [{ offerId: Number(offer.offer_id), buyerProductId: Number(buyerProductId), quantity }],
      ...(deliveryLocationId ? { deliveryLocationId: Number(deliveryLocationId) } : {}),
    }), t('wholesale.rfqSent'));
  };

  const submitQuote = (rfqId: Id, itemIds: Id[]) => {
    const prices = quotePrices[rfqId] ?? {};
    const rfq = dashboard.rfqs.find((row) => row.rfq_id === rfqId);
    const items = itemIds.map((id) => rfq?.items.find((item) => item.rfq_item_id === id));
    if (items.some((item, index) => {
      const price = Number(prices[itemIds[index]!] ?? item?.wholesale_price);
      return !item || !Number.isFinite(price) || price <= 0 || price > 99_999_999_999.99
        || Math.abs(price * 100 - Math.round(price * 100)) >= 1e-8;
    })) {
      setError(t('wholesale.enterAllQuotePrices'));
      return;
    }
    const validUntil = quoteValidUntil[rfqId]
      ?? (rfq?.valid_until ? toDateTimeLocal(rfq.valid_until) : '');
    if (validUntil && (!Number.isFinite(new Date(validUntil).getTime()) || new Date(validUntil).getTime() <= Date.now())) {
      setError(t('wholesale.quoteExpiryFuture'));
      return;
    }
    void runAction(`quote-${rfqId}`, () => wholesaleApi.quoteRfq(businessId, rfqId, {
      items: itemIds.map((rfqItemId, index) => ({
        rfqItemId: Number(rfqItemId),
        unitPrice: Number(prices[rfqItemId] ?? items[index]!.wholesale_price),
      })),
      ...(validUntil ? { validUntil: new Date(validUntil).toISOString() } : {}),
    }), t('wholesale.quoteSent'));
  };

  const createOrder = (rfqId: Id) => {
    void runAction(`order-${rfqId}`, () => wholesaleApi.createPurchaseOrder(businessId, {
      rfqId: Number(rfqId),
      ...(deliveryLocationId ? { deliveryLocationId: Number(deliveryLocationId) } : {}),
    }), t('wholesale.orderCreated'));
  };

  const transition = (order: WholesalePurchaseOrder, status: 'confirmed' | 'processing' | 'shipped' | 'cancelled') => {
    void runAction(`status-${order.purchase_order_id}`, () =>
      wholesaleApi.transitionPurchaseOrder(businessId, order.purchase_order_id, status), t('wholesale.orderUpdated'));
  };

  const receiveLine = (order: WholesalePurchaseOrder, itemId: Id, forceNew = false) => {
    if (!receiptStorageAvailable) {
      setError(t('wholesale.receiptRetryStorageError'));
      return;
    }
    const quantity = Number(receiptQuantities[order.purchase_order_id]?.[itemId]);
    const item = order.items.find((row) => row.purchase_order_item_id === itemId);
    const outstanding = item ? item.ordered_quantity - item.received_quantity : 0;
    if (!deliveryLocationId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > outstanding) {
      setError(t('wholesale.enterReceiptQuantity'));
      return;
    }
    const storageKey = receiptAttemptKey(businessId, order.purchase_order_id, itemId);
    let attempt: PendingReceiptAttempt;
    try {
      const pending = getPendingReceiptAttempt(storageKey, t('wholesale.receiptRetryStorageError'));
      if (pending && (pending.quantity !== quantity || pending.locationId !== Number(deliveryLocationId))) {
        setReceiptQuantities((current) => ({
          ...current,
          [order.purchase_order_id]: {
            ...current[order.purchase_order_id],
            [itemId]: String(pending.quantity),
          },
        }));
        setDeliveryLocationId(String(pending.locationId));
        setError(t('wholesale.receiptRetrySamePayload'));
        return;
      }
      attempt = pending ?? {
        idempotencyKey: !forceNew
          ? [...(receiptAttempts[order.purchase_order_id] ?? [])].reverse().find((saved) =>
            matchesReceiptAttempt(saved, itemId, quantity, Number(deliveryLocationId)))?.attemptId
            ?? crypto.randomUUID()
          : crypto.randomUUID(),
        quantity,
        locationId: Number(deliveryLocationId),
      };
      if (!pending) localStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      setReceiptStorageAvailable(false);
      setError(t('wholesale.receiptRetryStorageError'));
      return;
    }
    void runAction(`receipt-${order.purchase_order_id}-${itemId}`, () =>
      wholesaleApi.receivePurchaseOrder(businessId, order.purchase_order_id, {
        locationId: attempt.locationId,
        idempotencyKey: attempt.idempotencyKey,
        items: [{ purchaseOrderItemId: Number(itemId), quantity: attempt.quantity }],
      }), t('wholesale.receiptRecorded')).then((saved) => {
      if (!saved) return;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        setReceiptStorageAvailable(false);
        setError(t('wholesale.receiptRetryStorageError'));
      }
    });
  };

  const toggleOffer = (offer: WholesaleOffer) => {
    void runAction(`offer-status-${offer.offer_id}`, () =>
      wholesaleApi.updateOffer(businessId, offer.offer_id, {
        productId: Number(offer.product_id),
        wholesalePrice: Number(offer.wholesale_price),
        currency: offer.currency,
        minimumOrderQuantity: offer.minimum_order_quantity,
        availableQuantity: offer.available_quantity,
        status: offer.status === 'active' ? 'inactive' : 'active',
        tiers: offer.tiers.map((tier) => ({
          minimumQuantity: tier.minimum_quantity,
          maximumQuantity: tier.maximum_quantity,
          unitPrice: Number(tier.unit_price),
        })),
      }), t('wholesale.offerUpdated'));
  };

  const activityLabels: Record<string, string> = {
    'supplier.applied': 'supplierApplied',
    'supplier.approved': 'supplierApproved',
    'supplier.rejected': 'supplierRejected',
    'offer.created': 'offerCreated',
    'offer.saved': 'offerUpdated',
    'rfq.created': 'rfqCreated',
    'rfq.quoted': 'rfqQuoted',
    'rfq.accepted': 'rfqAccepted',
    'rfq.rejected': 'rfqRejected',
    'rfq.cancelled': 'rfqCancelled',
    'rfq.expired': 'rfqExpired',
    'purchase_order.created': 'orderCreated',
    'purchase_order.confirmed': 'orderConfirmed',
    'purchase_order.processing': 'orderProcessing',
    'purchase_order.shipped': 'orderShipped',
    'purchase_order.cancelled': 'orderCancelled',
    'purchase_order.received': 'orderReceived',
  };

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{t('wholesale.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-navy-600">{t('wholesale.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {t('wholesale.refresh')}
        </Button>
      </header>

      {permissionDenied ? (
        <Card>
          <p role="alert" className="text-sm font-medium text-error-700">{t('wholesale.permissionDenied')}</p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>{t('wholesale.tryAgain')}</Button>
        </Card>
      ) : loading ? (
        <section className="space-y-4" role="status" aria-label={t('wholesale.loading')}>
          <p className="text-sm text-navy-600">{t('wholesale.loading')}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <Card key={item} className="h-24 animate-pulse bg-navy-50"><span className="sr-only">{t('wholesale.loading')}</span></Card>)}
          </div>
          <Card className="h-48 animate-pulse bg-navy-50"><span className="sr-only">{t('wholesale.loading')}</span></Card>
        </section>
      ) : (
        <>
      {error && <p role="alert" className="rounded-lg bg-error-50 p-3 text-sm text-error-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-success-50 p-3 text-sm text-success-700">{notice}</p>}
      {!dashboard.canManageWholesale && <p role="status" className="rounded-lg bg-navy-50 p-3 text-sm text-navy-700">{t('wholesale.readOnlyAccess')}</p>}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-primary-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-navy-900">{t('notifications.title')}</h2>
          </div>
          <Badge variant={notifications.unreadCount > 0 ? 'success' : 'default'}>
            {t('notifications.unreadCount', { count: notifications.unreadCount })}
          </Badge>
        </div>
        {notificationError && <p role="alert" className="mb-3 text-sm text-error-700">{notificationError}</p>}
        {notifications.notifications.length === 0 ? (
          <p className="text-sm text-navy-600">{t('notifications.empty')}</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {notifications.notifications.map((notification) => {
              const status = String(notification.metadata.status ?? '');
              const decision = String(notification.metadata.decision ?? '');
              const message = notificationMessageKeys[notification.event_type] ?? 'notifications.events.unknown';
              const description = t(message, {
                id: notification.target_id,
                status: notificationOrderStatuses.has(status) ? t(`wholesale.orderStatus.${status}`) : '',
                decision: notificationRfqDecisions.has(decision) ? t(`wholesale.rfqStatus.${decision}`) : '',
              });
              const href = notificationLink(businessId, notification);
              return (
                <li key={notification.notification_id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${notification.read_at ? '' : 'bg-primary-50/50'}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${notification.read_at ? 'text-navy-700' : 'font-semibold text-navy-900'}`}>{description}</p>
                    <time className="text-xs text-navy-500" dateTime={notification.created_at}>
                      {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at))}
                    </time>
                  </div>
                  <div className="flex items-center gap-2">
                    {href && <Link
                      to={href}
                      onClick={() => void markNotificationRead(notification)}
                      className="text-sm font-medium text-primary-700 hover:text-primary-900"
                    >{t('notifications.viewRelated')}</Link>}
                    {!notification.read_at && <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void markNotificationRead(notification)}
                    ><Check size={14} aria-hidden="true" />{t('notifications.markRead')}</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {notifications.hasMore && <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadMoreNotifications()}>
          {t('notifications.loadMore')}
        </Button>}
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-primary-50 p-3 text-primary-700"><Store size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.activeOffers')}</p><p className="text-xl font-semibold">{supplierOffers.filter((offer) => offer.status === 'active').length} / {supplierOffers.length}</p><p className="text-xs text-navy-500">{t('wholesale.activeOfTotalOffers')}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-gold-50 p-3 text-gold-700"><Send size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.pendingRfqs')}</p><p className="text-xl font-semibold">{pendingSupplierRfqs.length}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-gold-50 p-3 text-gold-700"><BadgeCheck size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.quotesAwaitingAction')}</p><p className="text-xl font-semibold">{buyerQuotesAwaitingAction.length}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-primary-50 p-3 text-primary-700"><Truck size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.openPurchaseOrders')}</p><p className="text-xl font-semibold">{supplierOpenOrders.length}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-gold-50 p-3 text-gold-700"><Boxes size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.ordersAwaitingFulfillment')}</p><p className="text-xl font-semibold">{supplierOrdersAwaitingFulfillment.length}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <span className="rounded-lg bg-success-50 p-3 text-success-700"><Boxes size={20} /></span>
          <div><p className="text-sm text-navy-500">{t('wholesale.supplierSales')}</p><p className="text-sm font-semibold">{Object.entries(dashboard.stats.supplier_sales_by_currency).map(([currency, amount]) => money(amount, currency)).join(' · ') || money(0, 'USD')}</p></div>
        </Card>
      </section>

      <div id="rfqs"><Card>
        <div className="mb-3 flex items-center gap-2"><Activity size={18} className="text-primary-600" /><h2 className="text-lg font-semibold text-navy-900">{t('wholesale.recentActivity')}</h2></div>
        {dashboard.events.length === 0 ? <p className="text-sm text-navy-600">{t('wholesale.noActivity')}</p> : (
          <ul className="divide-y divide-navy-100">
            {dashboard.events.slice(0, 6).map((event) => (
              <li key={event.event_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="text-navy-800">{t(`wholesale.activityTypes.${activityLabels[event.event_type] ?? 'unknown'}`)}</span>
                <time className="text-xs text-navy-500" dateTime={event.created_at}>
                  {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dashboard.canManageWholesale && (!dashboard.supplier || dashboard.supplier.status === 'rejected') && (
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Store className="text-primary-600" />
            <div><h2 className="font-semibold text-navy-900">{t('wholesale.applyTitle')}</h2><p className="text-sm text-navy-600">{t('wholesale.applyDescription')}</p></div>
          </div>
          <form onSubmit={submitApplication} className="flex flex-col gap-3 sm:flex-row">
            <Input label={t('wholesale.supplierDescription')} value={applicationNote} onChange={(event) => setApplicationNote(event.target.value)} maxLength={2000} />
            <Button type="submit" loading={busy === 'application'} className="self-end"><Send size={16} />{t('wholesale.apply')}</Button>
          </form>
        </Card>
      )}
      {supplierPending && <p className="rounded-lg bg-gold-50 p-3 text-sm text-gold-800">{t('wholesale.applicationPending')}</p>}
      {dashboard.supplier && !supplierPending && !supplierApproved && (
        <p className="rounded-lg bg-navy-50 p-3 text-sm text-navy-700">{t(`wholesale.supplierStatus.${dashboard.supplier.status}`)}</p>
      )}

      {supplierApproved && (
        <Card>
          <div className="mb-4 flex items-center gap-2"><BadgeCheck className="text-success-600" /><h2 className="font-semibold text-navy-900">{t(editingOfferId ? 'wholesale.editOffer' : 'wholesale.createOffer')}</h2></div>
          {dashboard.canManageWholesale && (products.length === 0 ? <p className="text-sm text-navy-600">{t('wholesale.stockTrackedProductsOnly')}</p> : (
            <form onSubmit={submitOffer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm font-medium text-navy-700">{t('wholesale.product')}
                <select className="mt-1 w-full rounded-button border border-navy-300 bg-white px-3 py-2.5" value={offerDraft.productId} onChange={(event) => setOfferDraft({ ...offerDraft, productId: event.target.value })} required>
                  <option value="">{t('wholesale.chooseProduct')}</option>
                  {products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name} · {product.currency}</option>)}
                </select>
              </label>
              <Input type="number" min="0.01" step="0.01" label={t('wholesale.wholesalePrice')} value={offerDraft.wholesalePrice} onChange={(event) => setOfferDraft({ ...offerDraft, wholesalePrice: event.target.value })} required />
              <Input type="number" min="1" step="1" label={t('wholesale.moq')} value={offerDraft.minimumOrderQuantity} onChange={(event) => setOfferDraft({ ...offerDraft, minimumOrderQuantity: event.target.value })} required />
              <Input type="number" min="0" step="1" label={t('wholesale.availableQuantity')} value={offerDraft.availableQuantity} onChange={(event) => setOfferDraft({ ...offerDraft, availableQuantity: event.target.value })} required />
              <div className="space-y-3 sm:col-span-2 lg:col-span-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-navy-800">{t('wholesale.tierPricing')}</h3>
                  <Button type="button" size="sm" variant="outline" disabled={offerTiers.length >= 50} onClick={() => setOfferTiers([...offerTiers, { minimumQuantity: '', maximumQuantity: '', unitPrice: '' }])}>
                    <Plus size={15} aria-hidden="true" />{t('wholesale.addTier')}
                  </Button>
                </div>
                {offerTiers.map((tier, index) => (
                  <div key={index} className="grid items-end gap-3 rounded-lg bg-navy-50 p-3 sm:grid-cols-4">
                    <Input type="number" min={offerDraft.minimumOrderQuantity} step="1" label={t('wholesale.tierFrom')} value={tier.minimumQuantity} onChange={(event) => setOfferTiers(offerTiers.map((row, rowIndex) => rowIndex === index ? { ...row, minimumQuantity: event.target.value } : row))} required />
                    <Input type="number" min={tier.minimumQuantity || offerDraft.minimumOrderQuantity} step="1" label={t('wholesale.tierThrough')} helperText={t('wholesale.tierNoMaximum')} value={tier.maximumQuantity} onChange={(event) => setOfferTiers(offerTiers.map((row, rowIndex) => rowIndex === index ? { ...row, maximumQuantity: event.target.value } : row))} />
                    <Input type="number" min="0.01" step="0.01" label={t('wholesale.tierPrice')} value={tier.unitPrice} onChange={(event) => setOfferTiers(offerTiers.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: event.target.value } : row))} required />
                    <Button type="button" size="sm" variant="outline" aria-label={t('wholesale.removeTier')} onClick={() => setOfferTiers(offerTiers.filter((_, rowIndex) => rowIndex !== index))}><X size={15} aria-hidden="true" />{t('wholesale.removeTier')}</Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" loading={busy === 'offer'}><PackagePlus size={16} />{t(editingOfferId ? 'wholesale.saveOfferChanges' : 'wholesale.publishOffer')}</Button>
                {editingOfferId && <Button type="button" variant="outline" onClick={resetOfferDraft}>{t('wholesale.cancelEdit')}</Button>}
              </div>
            </form>
          ))}
          {dashboard.offers.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-navy-100 pt-4">
              {dashboard.offers.map((offer) => (
                <div key={offer.offer_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-navy-50 p-3">
                  <div><p className="font-medium text-navy-900">{offer.product_name}</p><p className="text-sm text-navy-600">{money(offer.wholesale_price, offer.currency)} · {t('wholesale.moq')}: {offer.minimum_order_quantity} · {t('wholesale.availableQuantity')}: {offer.available_quantity}</p>{offer.tiers.length > 0 && <p className="mt-1 text-xs text-navy-500">{offer.tiers.map((tier) => `${tier.minimum_quantity}${tier.maximum_quantity == null ? '+' : `–${tier.maximum_quantity}`} · ${money(tier.unit_price, offer.currency)}`).join(' / ')}</p>}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={offer.status === 'active' ? 'success' : 'default'}>{t(`wholesale.offerStatus.${offer.status}`)}</Badge>
                    {dashboard.canManageWholesale && <>
                      <Button size="sm" variant="outline" onClick={() => editOffer(offer)}><Pencil size={14} aria-hidden="true" />{t('wholesale.edit')}</Button>
                      <Button size="sm" variant="outline" loading={busy === `offer-status-${offer.offer_id}`} onClick={() => toggleOffer(offer)}>{offer.status === 'active' ? t('wholesale.deactivate') : t('wholesale.activate')}</Button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-xl font-semibold text-navy-900">{t('wholesale.discover')}</h2><p className="text-sm text-navy-600">{t('wholesale.compareOffers')}</p></div>
          <Input label={t('wholesale.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {loading ? <p className="text-sm text-navy-500">{t('wholesale.loading')}</p> : visibleOffers.length === 0 ? (
          <Card><p className="text-sm text-navy-600">{t('wholesale.noOffers')}</p></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleOffers.map((offer) => (
              <Card key={offer.offer_id}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-semibold text-navy-900">{offer.product_name}</h3><p className="text-sm text-navy-600">{offer.business_name}{offer.city ? ` · ${offer.city}` : ''}</p></div>
                  <Badge variant="success">{t('wholesale.offerStatus.active')}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-700">
                  <span>{money(offer.wholesale_price, offer.currency)}</span>
                  <span>{t('wholesale.moq')}: {offer.minimum_order_quantity}</span>
                  <span>{t('wholesale.availableQuantity')}: {offer.available_quantity}</span>
                </div>
                {offer.tiers.length > 0 && <p className="mt-2 text-xs text-navy-500">{offer.tiers.map((tier) => `${tier.minimum_quantity}${tier.maximum_quantity == null ? '+' : `–${tier.maximum_quantity}`} · ${money(tier.unit_price, offer.currency)}`).join(' / ')}</p>}
                {products.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-navy-700">{t('wholesale.stockProduct')}
                      <select className="mt-1 w-full rounded-button border border-navy-300 bg-white px-3 py-2" value={buyerProducts[offer.offer_id] ?? ''} onChange={(event) => setBuyerProducts({ ...buyerProducts, [offer.offer_id]: event.target.value })}>
                        {products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name}</option>)}
                      </select>
                    </label>
                    <Input type="number" min={offer.minimum_order_quantity} max={offer.available_quantity} step="1" label={t('wholesale.quantity')} value={quantities[offer.offer_id] ?? String(offer.minimum_order_quantity)} onChange={(event) => setQuantities({ ...quantities, [offer.offer_id]: event.target.value })} />
                  </div>
                )}
                {dashboard.canManageWholesale && <Button className="mt-3 w-full" disabled={products.length === 0 || offer.available_quantity === 0} loading={busy === `rfq-${offer.offer_id}`} onClick={() => requestQuote(offer)}><Send size={16} />{t('wholesale.requestQuote')}</Button>}
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card>
        <h2 className="mb-4 text-xl font-semibold text-navy-900">{t('wholesale.rfqs')}</h2>
        {dashboard.rfqs.length === 0 ? <p className="text-sm text-navy-600">{t('wholesale.noRfqs')}</p> : (
          <div className="space-y-4">
            {dashboard.rfqs.map((rfq) => {
              const isSupplier = rfq.supplier_business_id === businessId;
              return (
                <article id={`rfqs-${rfq.rfq_id}`} key={rfq.rfq_id} className="scroll-mt-24 rounded-lg border border-navy-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="font-medium">{isSupplier ? rfq.buyer_name : rfq.supplier_name}</p><p className="text-xs text-navy-500">{t('wholesale.rfqNumber', { id: rfq.rfq_id })}</p></div>
                    <Badge variant={rfq.status === 'accepted' ? 'success' : 'default'}>{t(`wholesale.rfqStatus.${rfq.status}`)}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {rfq.items.map((item) => (
                      <div key={item.rfq_item_id} className="grid gap-2 rounded bg-navy-50 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                        <span className="text-sm">{item.product_name} · {item.requested_quantity} {t('wholesale.units')}</span>
                        {dashboard.canManageWholesale && isSupplier && ['pending', 'quoted'].includes(rfq.status) && (
                          <Input type="number" min="0.01" step="0.01" aria-label={t('wholesale.quotePriceFor', { product: item.product_name })} placeholder={t('wholesale.quotePrice')} value={quotePrices[rfq.rfq_id]?.[item.rfq_item_id] ?? item.wholesale_price} onChange={(event) => setQuotePrices({ ...quotePrices, [rfq.rfq_id]: { ...quotePrices[rfq.rfq_id], [item.rfq_item_id]: event.target.value } })} />
                        )}
                        {item.quoted_unit_price && <span className="text-sm font-medium">{money(item.quoted_unit_price, item.currency)}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rfq.valid_until && <span className="self-center text-xs text-navy-500">{t('wholesale.quoteValidUntil')}: {new Date(rfq.valid_until).toLocaleString(i18n.language)}</span>}
                    {dashboard.canManageWholesale && isSupplier && ['pending', 'quoted'].includes(rfq.status) && <>
                      <Input type="datetime-local" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} label={t('wholesale.quoteValidUntil')} value={quoteValidUntil[rfq.rfq_id] ?? (rfq.valid_until ? toDateTimeLocal(rfq.valid_until) : '')} onChange={(event) => setQuoteValidUntil({ ...quoteValidUntil, [rfq.rfq_id]: event.target.value })} />
                      <Button size="sm" loading={busy === `quote-${rfq.rfq_id}`} onClick={() => submitQuote(rfq.rfq_id, rfq.items.map((item) => item.rfq_item_id))}>{t('wholesale.submitQuote')}</Button>
                    </>}
                    {dashboard.canManageWholesale && !isSupplier && rfq.status === 'quoted' && <>
                      <Button size="sm" loading={busy === `rfq-decision-${rfq.rfq_id}`} onClick={() => void runAction(`rfq-decision-${rfq.rfq_id}`, () => wholesaleApi.decideRfq(businessId, rfq.rfq_id, 'accepted'), t('wholesale.quoteAccepted'))}>{t('wholesale.acceptQuote')}</Button>
                      <Button size="sm" variant="outline" onClick={() => void runAction(`rfq-decision-${rfq.rfq_id}`, () => wholesaleApi.decideRfq(businessId, rfq.rfq_id, 'rejected'))}>{t('wholesale.rejectQuote')}</Button>
                    </>}
                    {dashboard.canManageWholesale && !isSupplier && rfq.status === 'accepted' && <Button size="sm" loading={busy === `order-${rfq.rfq_id}`} onClick={() => createOrder(rfq.rfq_id)}>{t('wholesale.placeOrder')}</Button>}
                    {dashboard.canManageWholesale && !isSupplier && ['pending', 'quoted'].includes(rfq.status) && <Button size="sm" variant="outline" loading={busy === `rfq-decision-${rfq.rfq_id}`} onClick={() => void runAction(`rfq-decision-${rfq.rfq_id}`, () => wholesaleApi.decideRfq(businessId, rfq.rfq_id, 'cancelled'), t('wholesale.rfqCancelled'))}>{t('wholesale.cancelRfq')}</Button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card></div>

      <div id="purchase-orders"><Card>
        <div className="mb-4 flex items-center gap-2"><Truck className="text-primary-600" /><h2 className="text-xl font-semibold text-navy-900">{t('wholesale.purchaseOrders')}</h2></div>
        {!receiptStorageAvailable && <p role="alert" className="mb-4 rounded-lg bg-error-50 p-3 text-sm text-error-700">{t('wholesale.receiptRetryStorageError')}</p>}
        {dashboard.canManageInventory && dashboard.canManageWholesale && <label className="mb-4 block max-w-sm text-sm font-medium text-navy-700">{t('wholesale.receivingLocation')}
          <select className="mt-1 w-full rounded-button border border-navy-300 bg-white px-3 py-2.5" value={deliveryLocationId} onChange={(event) => setDeliveryLocationId(event.target.value)}>
            <option value="">{t('wholesale.chooseLocation')}</option>
            {locations.map((location) => <option key={location.location_id} value={location.location_id}>{location.location_name}</option>)}
          </select>
        </label>}
        {dashboard.purchaseOrders.length === 0 ? <p className="text-sm text-navy-600">{t('wholesale.noOrders')}</p> : (
          <div className="space-y-4">
            {dashboard.purchaseOrders.map((order) => {
              const isSupplier = order.supplier_business_id === businessId;
              const nextStatus = order.status === 'pending_confirmation' ? 'confirmed'
                : order.status === 'confirmed' ? 'processing'
                  : order.status === 'processing' ? 'shipped' : null;
              return (
                <article id={`purchase-orders-${order.purchase_order_id}`} key={order.purchase_order_id} className="scroll-mt-24 rounded-lg border border-navy-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="font-semibold">{order.order_number}</p><p className="text-sm text-navy-600">{isSupplier ? order.buyer_name : order.supplier_name} · {money(order.total_amount, order.currency)}</p></div>
                    <Badge variant={order.status === 'delivered' ? 'success' : 'default'}>{t(`wholesale.orderStatus.${order.status}`)}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {order.items.map((item) => {
                      const outstanding = item.ordered_quantity - item.received_quantity;
                      const hasMatchingReceiptAttempt = (receiptAttempts[order.purchase_order_id] ?? []).some((attempt) =>
                        matchesReceiptAttempt(
                          attempt,
                          item.purchase_order_item_id,
                          Number(receiptQuantities[order.purchase_order_id]?.[item.purchase_order_item_id] ?? outstanding),
                          Number(deliveryLocationId),
                        ));
                      return <div key={item.purchase_order_item_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{item.product_name} · {item.received_quantity}/{item.ordered_quantity} {t('wholesale.units')} · {money(item.unit_price, order.currency)} {t('wholesale.perUnit')}</span>
                        {dashboard.canManageInventory && dashboard.canManageWholesale && receiptStorageAvailable && !isSupplier && outstanding > 0 && ['shipped', 'partially_delivered'].includes(order.status) && (
                          <div className="flex items-end gap-2">
                            <Input type="number" min="1" max={outstanding} step="1" className="w-28" aria-label={t('wholesale.receivedQuantity')} value={receiptQuantities[order.purchase_order_id]?.[item.purchase_order_item_id] ?? String(outstanding)} onChange={(event) => setReceiptQuantities({ ...receiptQuantities, [order.purchase_order_id]: { ...receiptQuantities[order.purchase_order_id], [item.purchase_order_item_id]: event.target.value } })} />
                            <Button size="sm" loading={busy === `receipt-${order.purchase_order_id}-${item.purchase_order_item_id}`} onClick={() => receiveLine(order, item.purchase_order_item_id)}>{hasMatchingReceiptAttempt ? t('wholesale.recoverReceipt') : t('wholesale.confirmReceipt')}</Button>
                            {hasMatchingReceiptAttempt && <Button size="sm" variant="outline" onClick={() => receiveLine(order, item.purchase_order_item_id, true)}>{t('wholesale.newReceipt')}</Button>}
                          </div>
                        )}
                      </div>;
                    })}
                  </div>
                  {order.buyer_business_id === businessId && (receiptAttempts[order.purchase_order_id] ?? [])
                    .filter((attempt) => attempt.state === 'completed' && attempt.result)
                    .map((attempt) => {
                      const receiptItems = Array.isArray(attempt.result?.items)
                        ? attempt.result.items as Array<Record<string, unknown>>
                        : [];
                      return <p key={attempt.attemptId} className="mt-2 text-xs text-navy-600">
                        {t('wholesale.receiptHistory')}: {receiptItems.map((receiptItem) =>
                          `${String(receiptItem.product_name)} × ${Number(receiptItem.received_quantity)}`).join(', ')}
                        {' · '}{new Date(attempt.createdAt).toLocaleString(i18n.language)}
                      </p>;
                    })}
                  {dashboard.canManageWholesale && isSupplier && nextStatus && <Button size="sm" className="mt-3 me-2" loading={busy === `status-${order.purchase_order_id}`} onClick={() => transition(order, nextStatus)}>{t(`wholesale.moveTo.${nextStatus}`)}</Button>}
                  {dashboard.canManageWholesale && ((isSupplier && ['pending_confirmation', 'confirmed', 'processing'].includes(order.status))
                    || (!isSupplier && order.status === 'pending_confirmation')) && (
                    <Button size="sm" variant="outline" className="mt-3" loading={busy === `status-${order.purchase_order_id}`} onClick={() => transition(order, 'cancelled')}>{t('wholesale.cancelOrder')}</Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Card></div>
        </>
      )}
    </div>
  );
}
