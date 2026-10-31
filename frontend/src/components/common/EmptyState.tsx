import { cn } from '../../lib/utils';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center py-12 px-4', className)}>
      <div className="w-16 h-16 rounded-full bg-navy-100 flex items-center justify-center text-navy-400 mb-4">
        {icon || <Inbox className="w-8 h-8" />}
      </div>
      <h3 className="text-lg font-semibold text-navy-900 mb-1">{title}</h3>
      {description && (
        <p className="text-navy-500 mb-6 max-w-sm">{description}</p>
      )}
      {action && (
        <div className="mt-2">{action}</div>
      )}
    </div>
  );
}