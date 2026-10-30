import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { isAxiosError } from 'axios';
import { cn } from '../../lib/utils';
import { adminApi, inAppNotificationApi } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import type { AdminBusinessNotifications, BusinessApprovalNotification, InAppNotification } from '../../types';
import { SseClient } from '../../lib/sseClient';

interface HeaderNotification {
  id: string;
  createdAt: string;
  read: boolean;
  title: string;
  body?: string;
  href: string;
  onRead?: () => Promise<void>;
}

const notificationMessageKeys: Record<string, string> = {
  'wholesale.purchase_order.created': 'notifications.events.purchaseOrderCreated',
  'wholesale.purchase_order.status_changed': 'notifications.events.purchaseOrderStatusChanged',
  'wholesale.rfq.created': 'notifications.events.rfqCreated',
  'wholesale.rfq.quoted': 'notifications.events.rfqQuoted',
  'wholesale.rfq.decided': 'notifications.events.rfqDecided',
  'wholesale.receipt.recorded': 'notifications.events.receiptRecorded',
};

const orderStatuses = new Set([
  'pending_confirmation', 'confirmed', 'processing', 'shipped', 'partially_delivered', 'delivered', 'cancelled',
]);
const rfqDecisions = new Set(['accepted', 'rejected', 'cancelled']);

function wholesaleHref(businessId: string, notification: InAppNotification): string {
  const targetId = Number(notification.target_id);
  const section = notification.target_type === 'purchase_order' ? 'purchase-orders' : 'rfqs';
  return Number.isSafeInteger(targetId) && targetId > 0
    ? `/dashboard/business/${encodeURIComponent(businessId)}/wholesale#${section}-${targetId}`
    : `/dashboard/business/${encodeURIComponent(businessId)}/wholesale`;
}

function formatTimestamp(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function NotificationBell({ light = false }: { light?: boolean }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, currentBusiness, hasPlatformRole, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HeaderNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [badgePulse, setBadgePulse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const previousUnreadCount = useRef(0);
  const isPlatformAdmin = hasPlatformRole('platform_admin');
  const businessId = currentBusiness?.business_id;
  const sseClientRef = useRef<SseClient | null>(null);
  const useSSERef = useRef(true);
  const lastEventIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const pollingVisibilityRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    const nextItems: HeaderNotification[] = [];
    let nextUnreadCount = 0;
    let failed = false;

    if (isPlatformAdmin) {
      try {
        const response = await adminApi.getBusinessNotifications();
        const notifications: AdminBusinessNotifications = response.data.data;
        nextUnreadCount += notifications.unreadCount;
        nextItems.push(...notifications.recent.map((item) => ({
          id: `admin-${item.business_id}`,
          createdAt: item.created_at,
          read: !item.is_new,
          title: item.business_name,
          body: t(`status.${item.status}`),
          href: `/admin/businesses?search=${encodeURIComponent(item.business_name)}`,
        })));
      } catch {
        failed = true;
      }
    }

    if (businessId) {
      const [eventResult, approvalResult] = await Promise.allSettled([
        inAppNotificationApi.list(businessId, { limit: 10, offset: 0 }),
        inAppNotificationApi.listApprovals(businessId, { limit: 10, offset: 0 }),
      ]);

      if (eventResult.status === 'fulfilled') {
        const page = eventResult.value.data.data;
        nextUnreadCount += page.unreadCount;
        nextItems.push(...page.notifications.map((notification) => {
          const status = String(notification.metadata.status ?? '');
          const decision = String(notification.metadata.decision ?? '');
          return {
            id: `event-${notification.notification_id}`,
            createdAt: notification.created_at,
            read: notification.read_at !== null,
            title: t(notificationMessageKeys[notification.event_type] ?? 'notifications.events.unknown', {
              id: notification.target_id,
              status: orderStatuses.has(status) ? t(`wholesale.orderStatus.${status}`) : '',
              decision: rfqDecisions.has(decision) ? t(`wholesale.rfqStatus.${decision}`) : '',
            }),
            href: wholesaleHref(businessId, notification),
            onRead: () => inAppNotificationApi.markRead(businessId, notification.notification_id).then(() => undefined),
          };
        }));
      } else {
        failed ||= !(isAxiosError(eventResult.reason) && eventResult.reason.response?.status === 403);
      }

      if (approvalResult.status === 'fulfilled') {
        const page = approvalResult.value.data.data;
        nextUnreadCount += page.unreadCount;
        nextItems.push(...page.notifications.map((notification: BusinessApprovalNotification) => ({
          id: `approval-${notification.notification_id}`,
          createdAt: notification.created_at,
          read: notification.read_at !== null,
          title: t('approvalNotice.title'),
          body: t('approvalNotice.body'),
          href: `/business/${encodeURIComponent(notification.business_slug)}`,
          onRead: () => inAppNotificationApi.markApprovalRead(businessId, notification.notification_id).then(() => undefined),
        })));
      } else {
        failed = true;
      }
    }

    nextItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(nextItems.slice(0, 10));
    setUnreadCount(nextUnreadCount);
    setError(failed);
    if (nextUnreadCount > previousUnreadCount.current) {
      setBadgePulse(true);
      window.setTimeout(() => setBadgePulse(false), 700);
    }
    previousUnreadCount.current = nextUnreadCount;
  }, [businessId, isAuthenticated, isPlatformAdmin, t]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      sseClientRef.current?.stop();
      sseClientRef.current = null;
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      if (pollingVisibilityRef.current) {
        document.removeEventListener('visibilitychange', pollingVisibilityRef.current);
        pollingVisibilityRef.current = null;
      }
      return;
    }
    void refresh();

    const startPolling = () => {
      if (pollingIntervalRef.current) return;
      pollingIntervalRef.current = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, 30000);
      pollingVisibilityRef.current = () => {
        if (document.visibilityState === 'visible') void refresh();
      };
      document.addEventListener('visibilitychange', pollingVisibilityRef.current);
    };

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (pollingVisibilityRef.current) {
        document.removeEventListener('visibilitychange', pollingVisibilityRef.current);
        pollingVisibilityRef.current = null;
      }
    };

    const client = new SseClient({
      url: `/api/business/${businessId}/notifications/stream`,
      getToken: () => localStorage.getItem('hq_token') || sessionStorage.getItem('hq_token'),
      getLastEventId: () => lastEventIdRef.current,
      onUnauthorized: () => logout(),
      onFrame: (frame) => {
        if (frame.id) lastEventIdRef.current = frame.id;
        if (frame.eventType === 'ping') return;
        if (frame.eventType === 'notifications.reset') {
          lastEventIdRef.current = null;
        }
        void refresh();
      },
      onPolling: (enabled) => {
        useSSERef.current = !enabled;
        if (enabled) startPolling();
        else stopPolling();
      },
      onBeforeReconnect: () => refresh(),
    });
    sseClientRef.current = client;

    if (!businessId || document.visibilityState === 'hidden') {
      startPolling();
    } else if (useSSERef.current) {
      client.start();
    } else {
      startPolling();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sseClientRef.current?.stop();
      } else if (useSSERef.current) {
        void refresh();
        sseClientRef.current?.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      sseClientRef.current?.stop();
      sseClientRef.current = null;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, refresh, businessId, logout]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      if (isPlatformAdmin) await adminApi.markBusinessNotificationsSeen();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const openItem = async (item: HeaderNotification) => {
    if (item.onRead && !item.read) {
      try {
        await item.onRead();
      } catch {
        setError(true);
        return;
      }
    }
    setOpen(false);
    navigate(item.href);
    void refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={t('notifications.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'relative rounded-button p-2 transition-colors',
          open
            ? 'bg-primary-50 text-primary-700'
            : light ? 'text-white hover:bg-white/15' : 'text-navy-600 hover:bg-navy-100',
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className={cn(
            'absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1 text-xs text-white',
            badgePulse && 'animate-bounce',
          )}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute end-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-navy-200 bg-white p-3 text-navy-900 shadow-card animate-slide-down"
        >
          <div className="flex items-center justify-between border-b border-navy-100 pb-2">
            <h2 className="font-semibold">{t('notifications.headerTitle')}</h2>
            <span className="text-xs text-navy-500">{t('notifications.unreadCount', { count: unreadCount })}</span>
          </div>
          {error && <p className="py-2 text-sm text-error-600" role="alert">{t('notifications.loadError')}</p>}
          {loading ? (
            <p className="py-4 text-center text-sm text-navy-500">{t('common.loading')}</p>
          ) : items.length ? (
            <ul className="max-h-80 divide-y divide-navy-100 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    className={cn(
                      'flex w-full items-start gap-3 py-3 text-start hover:bg-navy-50',
                      !item.read && 'bg-primary-50/50',
                    )}
                  >
                    <span className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      item.read ? 'bg-transparent' : 'bg-primary-600',
                    )} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', item.read ? 'text-navy-700' : 'font-semibold text-navy-900')}>
                        {item.title}
                      </span>
                      {item.body && <span className="block text-xs text-navy-600">{item.body}</span>}
                      <time className="mt-1 block text-xs text-navy-500" dateTime={item.createdAt}>
                        {formatTimestamp(item.createdAt, i18n.language)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-5 text-center text-sm text-navy-500">
              {isAuthenticated ? t('notifications.empty') : t('notifications.signInPrompt')}
            </p>
          )}
          {!isAuthenticated ? (
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-button px-3 py-2 text-center text-sm font-medium text-primary-700 hover:bg-primary-50"
            >
              {t('nav.signIn')}
            </Link>
          ) : (isPlatformAdmin || businessId) && (
            <Link
              to={isPlatformAdmin ? '/admin/businesses' : `/dashboard/business/${encodeURIComponent(businessId!)}/wholesale`}
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-button px-3 py-2 text-center text-sm font-medium text-primary-700 hover:bg-primary-50"
            >
              {t('notifications.viewAll')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
