import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface ErrorStateProps {
  /** Defaults to the generic translated message; pass a specific one to override. */
  message?: string;
  onRetry?: () => void;
  className?: string;
  title?: string;
}

export function ErrorState({ message, onRetry, className, title }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-col items-center text-center py-12 px-4', className)}>
      <div className="w-16 h-16 rounded-full bg-error-50 flex items-center justify-center text-error-500 mb-4">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <h3 className="text-lg font-semibold text-navy-900 mb-1">{title ?? t('common.errorTitle')}</h3>
      <p className="text-navy-500 mb-6 max-w-sm">{message ?? t('errors.generic')}</p>
      {onRetry && (
        <button 
          onClick={onRetry} 
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-button hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}