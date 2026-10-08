import { useCallback, useState } from 'react';

export interface ToastMessage {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

/**
 * Toast state plus a `show` function, with the dismissal timer included.
 *
 * The id is the timer's own handle, which makes a toast's identity and its
 * expiry the same number: there is no separate id to allocate and no way for
 * the two to disagree.
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
