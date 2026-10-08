import { cn } from '../../lib/utils';
import type { ToastMessage } from './useToasts';

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
