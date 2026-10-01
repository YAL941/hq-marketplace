import { clsx, type ClassValue } from 'clsx';
import i18n from '../i18n';
import { intlLocaleFor } from '../i18n';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Everything below formats for whichever language is active right now.
 *
 * The locale is read from i18n on every call rather than captured once, so a
 * page does not have to remount when the language changes. Somali has no CLDR
 * locale, so it formats as English while still using Somali wording around it.
 */
function locale(): string {
  return intlLocaleFor(i18n.resolvedLanguage ?? i18n.language);
}

function toNumber(amount: string | number): number {
  return typeof amount === 'string' ? parseFloat(amount) : amount;
}

export function formatCurrency(amount: string | number, currency = 'USD'): string {
  const value = toNumber(amount);
  if (Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: string | number): string {
  const num = toNumber(value);
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat(locale()).format(num);
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat(locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString));
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat(locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return i18n.t('relativeTime.justNow');
  if (diffMins < 60) return i18n.t('relativeTime.minutes', { count: diffMins });
  if (diffHours < 24) return i18n.t('relativeTime.hours', { count: diffHours });
  if (diffDays < 7) return i18n.t('relativeTime.days', { count: diffDays });
  return formatDate(dateString);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length).trim() + '...';
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-success-500',
    pending: 'bg-warning-500',
    suspended: 'bg-error-500',
    closed: 'bg-navy-400',
    rejected: 'bg-error-500',
    verified: 'bg-success-500',
    draft: 'bg-navy-400',
    inactive: 'bg-navy-400',
    archived: 'bg-navy-500',
    completed: 'bg-success-500',
    cancelled: 'bg-error-500',
    confirmed: 'bg-primary-500',
    in_progress: 'bg-primary-500',
    ready: 'bg-primary-500',
    out_for_delivery: 'bg-primary-500',
    refunded: 'bg-warning-500',
    published: 'bg-success-500',
    hidden: 'bg-navy-400',
  };
  return colors[status] || 'bg-navy-400';
}

/** DB status values map to camelCase translation keys. */
const STATUS_LABEL_KEYS: Record<string, string> = {
  active: 'active',
  pending: 'pending',
  suspended: 'suspended',
  closed: 'closed',
  rejected: 'rejected',
  verified: 'verified',
  draft: 'draft',
  inactive: 'inactive',
  archived: 'archived',
  completed: 'completed',
  cancelled: 'cancelled',
  confirmed: 'confirmed',
  in_progress: 'inProgress',
  ready: 'ready',
  out_for_delivery: 'outForDelivery',
  refunded: 'refunded',
  published: 'published',
  hidden: 'hidden',
};

export function getStatusLabel(status: string): string {
  const key = STATUS_LABEL_KEYS[status];
  // An unknown status falls through to the raw value rather than to a key
  // string, so a status the UI has not caught up with is still readable.
  if (!key) return status;
  return i18n.t(`status.${key}`);
}