import { cn } from '../../lib/utils';
import { Card } from './Card';

export interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, variant = 'text', width, height }: SkeletonProps) {
  const baseStyles = 'animate-pulse bg-navy-200 rounded';

  const variants = {
    text: 'h-4 w-full',
    circular: 'rounded-full',
    rectangular: 'rounded-button',
  };

  return (
    <div
      className={cn(baseStyles, variants[variant], className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function BusinessCardSkeleton() {
  return (
    <Card padding="none" className="overflow-hidden">
      <Skeleton variant="rectangular" className="aspect-video w-full" />
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" width={48} height={48} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
        <Skeleton variant="text" width="80%" />
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" width="40%" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton variant="text" width="20%" />
          <Skeleton variant="text" width="30%" />
        </div>
      </div>
    </Card>
  );
}

export function BusinessHeaderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton variant="rectangular" className="aspect-[21/9] w-full rounded-card" />
      <div className="flex items-start gap-4 px-2">
        <Skeleton variant="circular" width={80} height={80} />
        <div className="flex-1 space-y-3 pt-2">
          <div className="flex items-center gap-3">
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="text" width="20%" />
          </div>
          <Skeleton variant="text" width="60%" />
          <div className="flex flex-wrap gap-2">
            <Skeleton variant="rectangular" width={100} height={32} />
            <Skeleton variant="rectangular" width={100} height={32} />
            <Skeleton variant="rectangular" width={100} height={32} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CategoryCardSkeleton() {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-5 flex items-center gap-4">
        <Skeleton variant="circular" width={56} height={56} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="50%" />
          <Skeleton variant="text" width="30%" />
        </div>
      </div>
    </Card>
  );
}

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="p-5">
          <Skeleton variant="text" width="40%" className="mb-2" />
          <Skeleton variant="text" width="60%" height={32} />
        </Card>
      ))}
    </div>
  );
}

/** Placeholder rows for a staff list, so the page does not jump when data lands. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_unused, index) => (
        <div key={index} className="flex items-center gap-4 rounded-card border border-navy-200 p-4">
          <Skeleton variant="rectangular" width={56} height={56} className="rounded-card" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="35%" />
            <Skeleton variant="text" width="55%" />
          </div>
          <Skeleton variant="text" width={80} className="hidden sm:block" />
        </div>
      ))}
    </div>
  );
}