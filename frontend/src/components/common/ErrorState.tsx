import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export interface ErrorStateProps {
  /** Defaults to the generic translated message; pass a specific one to override. */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-col items-center text-center py-12 px-4', className)}>
      <div className="w-16 h-16 rounded-full bg-error-50 flex items-center justify-center text-error-500 mb-4">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-navy-900 mb-1">{t('common.errorTitle')}</h3>
      <p className="text-navy-500 mb-6 max-w-sm">{message ?? t('errors.generic')}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-4 py-2 bg-primary-600 text-white rounded-button hover:bg-primary-700 transition-colors">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}