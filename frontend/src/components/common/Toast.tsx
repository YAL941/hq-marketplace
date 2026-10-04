import { useCallback, useState } from 'react';
import { cn } from '../../lib/utils';

export interface ToastMessage {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

/**
 * A transient confirmation pinned to the bottom of the viewport.
 *
 * This exists because the operations that need one are otherwise silent: an
 * upload swaps the preview in place, so without a toast there is nothing on
 * screen saying the file actually reached the server — and a person who then
 * reloads the page has no reason to expect their change survived.
 *
 * Failures are reported here *as well as* next to the control that failed. The
 * inline message belongs to the field; the toast is what makes a 403 or a rate
 * limit visible when the control sat above the fold or the reader had scrolled.
 */
export function Toast({ toast, onRemove }: { toast: ToastMessage; onRemove: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-4 start-4 z-50 max-w-sm rounded-card border px-4 py-3 shadow-card text-sm',
        toast.kind === 'success'
          ? 'bg-success-50 text-success-700 border-success-200'
          : 'bg-error-50 text-error-700 border-error-200',
      )}
    >
      {toast.message}
      <button
        type="button"
        onClick={onRemove}
        className="absolute end-2 top-2 text-navy-400 hover:text-navy-600"
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  );
}

/**
 * Toast state plus a `show` function, with the dismissal timer included.
 *
 * The id is the timer's own handle, which makes a toast's identity and its
 * expiry the same number: there is no separate id to allocate and no way for the
 * two to disagree.
 */
export function useToasts(autoDismissMs = 4000) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const show = useCallback(
    (message: string, kind: 'success' | 'error') => {
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== timer));
      }, autoDismissMs);
      setToasts((current) => [...current, { id: Number(timer), message, kind }]);
    },
    [autoDismissMs],
  );

  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );

  return { toasts, show, dismiss };
}
