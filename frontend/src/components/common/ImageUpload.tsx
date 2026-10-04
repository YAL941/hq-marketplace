import { ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import i18n from '../../i18n';
import { cn, formatBytes } from '../../lib/utils';
import {
  describeMediaIssue,
  isAcceptableImageType,
  isManagedUpload,
  resolveMediaUrl,
  UPLOAD_ACCEPT,
  UPLOAD_LIMITS,
  type UploadKind,
} from '../../lib/media';
import { mediaApi, toFieldIssue } from '../../services/api';
import type { Id } from '../../types';
import { Button } from './Button';

/**
 * Which column the stored URL lives in, per slot.
 *
 * The three uploads answer with different row types — a business for logo and
 * cover, a product for the product image — but the caller only ever wants one
 * string back, so the widget reads this name off whatever row arrived instead of
 * branching on the response's type.
 */
const STORED_FIELD = {
  logo: 'logo_url',
  cover: 'cover_image_url',
  product: 'image_url',
} as const satisfies Record<UploadKind, string>;

export interface ImageUploadProps {
  /** Which of the three server slots this widget writes to. */
  kind: UploadKind;
  businessId: Id;
  /** Required for `kind: 'product'`; the product route is addressed by both ids. */
  productId?: Id;
  /** The current stored value, exactly as the database holds it. */
  value: string | null;
  /** Receives the new value, or null after a removal. */
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** `square` for a logo, `wide` for a cover or a product photo. */
  shape?: 'square' | 'wide';
  className?: string;
  /**
   * Called for every finished request, successful or not.
   *
   * A parent uses this for a toast. Failures are reported both here and inline,
   * on purpose: the inline message sits next to the button that caused it, and
   * the toast is what makes a 403 or a 429 noticeable when the upload happened
   * above the fold or the user had scrolled away.
   */
  onNotify?: (kind: 'success' | 'error', message: string) => void;
  /**
   * Reports whether a request is in flight.
   *
   * The widget needs this from the parent because the race it prevents is
   * between two siblings: a PATCH saving the whole profile must not land while
   * an upload is replacing a column the same PATCH is about to write, and the
   * upload buttons must not be live while that PATCH is in flight.
   */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * One image slot: pick a file, watch it upload, remove it again.
 *
 * The component owns the whole request lifecycle so the three screens that use
 * it do not each grow their own copy of a progress bar and an error parser. It
 * is uncontrolled with respect to the value — `value` and `onChange` are the
 * source of truth, because a parent that re-fetches the business must be able
 * to overwrite what is shown here.
 *
 * Two refusals happen here rather than on the wire, and both are about the user
 * waiting needlessly rather than about correctness: an unsupported type and an
 * oversized file are refused locally, while the server still reads the bytes and
 * stays the authority. The locally-known ceiling is only ever used for wording —
 * `FILE_TOO_LARGE` quotes the `maxBytes` the server actually enforced.
 */
export function ImageUpload({
  kind,
  businessId,
  productId,
  value,
  onChange,
  disabled,
  shape = 'square',
  className,
  onNotify,
  onBusyChange,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const limit = UPLOAD_LIMITS[kind];
  const preview = resolveMediaUrl(value);
  const locked = Boolean(disabled || busy || removing);
  // The delete endpoints only remove a file this API produced. An external link
  // is still a perfectly good image, so it is shown without a Remove button
  // rather than offering one that would fail or, worse, clear somebody else's
  // asset.
  const canRemove = isManagedUpload(value);
  const inFlight = busy || removing;

  // Reported upward rather than read by the parent, because the parent cannot
  // see inside this component. `inFlight` is the single value both the buttons
  // and the notification depend on, so the two can never disagree.
  useEffect(() => {
    onBusyChange?.(inFlight);
  }, [inFlight, onBusyChange]);

  /**
   * One place where a message is both shown inline and handed to the parent, so
   * a failure can never be reported to one and hidden from the other.
   */
  function fail(message: string) {
    setError(message);
    onNotify?.('error', message);
  }

  function pick() {
    if (locked) return;
    setError(null);
    inputRef.current?.click();
  }

  async function send(file: File, onProgress: (p: number) => void) {
    if (kind === 'product') {
      if (productId === undefined) throw new Error('productId is required for a product image');
      const res = await mediaApi.uploadProductImage(businessId, productId, file, onProgress);
      return res.data.data;
    }
    const res =
      kind === 'logo'
        ? await mediaApi.uploadLogo(businessId, file, onProgress)
        : await mediaApi.uploadCover(businessId, file, onProgress);
    return res.data.data;
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared first, so choosing the same file twice in a row still fires
    // `change` — otherwise the second pick is silently ignored because the
    // input's value never changed.
    event.target.value = '';
    if (!file) return;

    setError(null);

    if (!isAcceptableImageType(file)) {
      // The picker already filters these, so reaching here means the file came
      // from somewhere else — a drag-and-drop, or a browser that ignored
      // `accept`. Refusing it here costs nothing; the server would refuse it too.
      fail(i18n.t('upload.unsupportedType'));
      return;
    }
    if (file.size > limit) {
      fail(i18n.t('upload.tooLarge', { max: formatBytes(limit) }));
      return;
    }

    setBusy(true);
    setPercent(0);
    try {
      // `send` returns either a business row or a product row depending on the slot;
      // `unknown` is the honest bridge, since both are read only through the one
      // column name this slot uses.
      const row = (await send(file, setPercent)) as unknown as Record<string, string | null> | undefined;
      onChange(row?.[STORED_FIELD[kind]] ?? null);
      onNotify?.('success', i18n.t('upload.uploaded'));
    } catch (caught) {
      fail(describeMediaIssue(toFieldIssue(caught), limit));
    } finally {
      setBusy(false);
      setPercent(null);
    }
  }

  async function handleRemove() {
    if (locked || !canRemove) return;
    setError(null);
    setRemoving(true);
    try {
      if (kind === 'product') {
        if (productId === undefined) throw new Error('productId is required to remove a product image');
        await mediaApi.removeProductImage(businessId, productId);
      } else if (kind === 'logo') {
        await mediaApi.removeLogo(businessId);
      } else {
        await mediaApi.removeCover(businessId);
      }
      // The DELETE answers 204 with no row, so the new value is known rather
      // than fetched: the slot was emptied, and only a managed path could reach
      // this branch.
      onChange(null);
      onNotify?.('success', i18n.t('upload.removed'));
    } catch (caught) {
      fail(describeMediaIssue(toFieldIssue(caught), limit) || i18n.t('upload.removeFailed'));
    } finally {
      setRemoving(false);
    }
  }

  const frame = shape === 'square' ? 'aspect-square w-32' : 'aspect-[16/9] w-full max-w-md';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-card border-2 border-dashed border-navy-200 bg-navy-50',
          frame,
        )}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-3 text-center text-sm text-navy-400">{i18n.t('upload.empty')}</span>
        )}
      </div>

      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        onChange={handleFile}
        disabled={locked}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={pick} disabled={locked}>
          {preview ? i18n.t('upload.replace') : i18n.t('upload.choose')}
        </Button>

        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={locked}
            loading={removing}
          >
            {i18n.t('upload.remove')}
          </Button>
        )}
      </div>

      {percent !== null && (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-navy-100">
            <div
              className="h-full bg-primary-600 transition-all duration-200"
              style={{ width: `${percent}%` }}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <span className="text-xs text-navy-500">{i18n.t('upload.progress', { percent })}</span>
        </div>
      )}

      {!percent && busy && <span className="text-xs text-navy-500">{i18n.t('upload.uploading')}</span>}

      <p className="text-xs text-navy-500">{i18n.t('upload.hint', { max: formatBytes(limit) })}</p>

      {!canRemove && preview && <p className="text-xs text-navy-500">{i18n.t('upload.externalNotice')}</p>}

      {error && (
        <p role="alert" className="text-sm text-error-600">
          {error}
        </p>
      )}
    </div>
  );
}