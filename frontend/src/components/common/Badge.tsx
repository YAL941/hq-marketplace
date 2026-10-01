import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'verified';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Renders a dismiss button; used for the active filter chips on Explore. */
  onRemove?: () => void;
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  onRemove,
  className,
}: BadgeProps) {
  const variants: Record<BadgeVariant, string> = {
    default: 'bg-navy-100 text-navy-700',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    error: 'bg-error-50 text-error-600',
    info: 'bg-primary-50 text-primary-600',
    verified: 'bg-success-50 text-success-600 border border-success-200',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-sm gap-1.5',
    lg: 'px-3 py-1.5 text-base gap-2',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="rounded-full hover:bg-black/10 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}