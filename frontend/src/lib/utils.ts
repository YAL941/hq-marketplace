import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: string | number, currency = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString));
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
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

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
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
    rejected: 'bg-error-500',
    refunded: 'bg-warning-500',
    published: 'bg-success-500',
    hidden: 'bg-navy-400',
  };
  return colors[status] || 'bg-navy-400';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Active',
    pending: 'Pending',
    suspended: 'Suspended',
    closed: 'Closed',
    rejected: 'Rejected',
    verified: 'Verified',
    draft: 'Draft',
    inactive: 'Inactive',
    archived: 'Archived',
    completed: 'Completed',
    cancelled: 'Cancelled',
    confirmed: 'Confirmed',
    in_progress: 'In Progress',
    ready: 'Ready',
    out_for_delivery: 'Out for Delivery',
    rejected: 'Rejected',
    refunded: 'Refunded',
    published: 'Published',
    hidden: 'Hidden',
  };
  return labels[status] || status;
}