import { ChangeEvent, PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { Pencil, RotateCcw, RotateCw } from 'lucide-react';
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

const PRODUCT_IMAGE_MAX_WIDTH = 1200;
const PRODUCT_IMAGE_HEIGHT = 900;

interface ImageEdit {
  zoom: number;
  rotation: number;
  // Pan is measured in viewport pixels, so dragging feels the same at every zoom.
  offsetX: number;
  offsetY: number;
}

function drawImageInViewport(canvas: HTMLCanvasElement, image: HTMLImageElement, edit: ImageEdit): void {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const radians = (edit.rotation * Math.PI) / 180;
  const rotatedWidth = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
  const rotatedHeight = Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height;
  const fitScale = Math.max(canvas.width / rotatedWidth, canvas.height / rotatedHeight);
  const imageScale = fitScale * edit.zoom;
  const renderedWidth = rotatedWidth * imageScale;
  const renderedHeight = rotatedHeight * imageScale;
  const maxOffsetX = Math.max(0, (renderedWidth - canvas.width) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - canvas.height) / 2);
  const offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, edit.offsetX));
  const offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, edit.offsetY));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable.');

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
  context.rotate(radians);
  context.scale(imageScale, imageScale);
  context.drawImage(image, -width / 2, -height / 2);
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The edited image could not be encoded.'));
    }, 'image/webp', quality);
  });
}

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
   * Replaces the format-and-size line.
   *
   * Used when the widget is shown but cannot be used yet — a product that has no
   * id cannot be uploaded to, and the useful thing to say there is why, rather
   * than a ceiling that would only tempt someone to try.
   */
  hint?: string;
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
 * One image slot: pick a file, optionally edit product images, watch it upload,
 * and remove it again.
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
  hint,
  onNotify,
  onBusyChange,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorDialogRef = useRef<HTMLElement>(null);
  const editorUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorImage, setEditorImage] = useState<{ image: HTMLImageElement; fileName: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [editorError, setEditorError] = useState<string | null>(null);
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
  lockedRef.current = locked;

  useEffect(
    () => () => {
      if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!editorImage || !editorCanvasRef.current) return;
    try {
      drawImageInViewport(
        editorCanvasRef.current,
        editorImage.image,
        { zoom, rotation, offsetX, offsetY },
      );
      setEditorError(null);
    } catch {
      setEditorError(i18n.t('upload.editFailed'));
    }
  }, [editorImage, zoom, rotation, offsetX, offsetY]);

  useEffect(() => {
    if (!editorImage) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = editorDialogRef.current;
    const focusable = () => dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [];
    focusable()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !lockedRef.current) {
        resetEdit();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [editorImage]);

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

  async function upload(file: File): Promise<boolean> {
    setBusy(true);
    setPercent(0);
    try {
      // `send` returns either a business row or a product row depending on the slot;
      // `unknown` is the honest bridge, since both are read only through the one
      // column name this slot uses.
      const row = (await send(file, setPercent)) as unknown as Record<string, string | null> | undefined;
      onChange(row?.[STORED_FIELD[kind]] ?? null);
      onNotify?.('success', i18n.t('upload.uploaded'));
      return true;
    } catch (caught) {
      fail(describeMediaIssue(toFieldIssue(caught), limit));
      return false;
    } finally {
      setBusy(false);
      setPercent(null);
    }
  }

  function resetEdit() {
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
    editorUrlRef.current = null;
    setEditorImage(null);
    setZoom(1);
    setRotation(0);
    setOffsetX(0);
    setOffsetY(0);
    setEditorError(null);
    dragRef.current = null;
    pendingPanRef.current = null;
    if (panFrameRef.current !== null) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
  }

  async function openEditor(source: File | string, fileName: string) {
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
    editorUrlRef.current = null;
    setError(null);
    setEditorError(null);
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const sourceUrl = source instanceof File ? URL.createObjectURL(source) : source;
      if (source instanceof File) editorUrlRef.current = sourceUrl;
      image.src = sourceUrl;
      await image.decode();
      setZoom(1);
      setRotation(0);
      setOffsetX(0);
      setOffsetY(0);
      setEditorImage({ image, fileName });
    } catch {
      resetEdit();
      fail(i18n.t('upload.imageReadFailed'));
    }
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

    if (kind === 'product') {
      await openEditor(file, file.name);
      return;
    }
    await upload(file);
  }

  async function handleSaveEdit() {
    if (!editorImage || locked) return;
    setEditorError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = PRODUCT_IMAGE_MAX_WIDTH;
      canvas.height = PRODUCT_IMAGE_HEIGHT;
      drawImageInViewport(canvas, editorImage.image, { zoom, rotation, offsetX, offsetY });
      let blob = await canvasToWebp(canvas, 0.9);
      if (blob.size > limit) blob = await canvasToWebp(canvas, 0.78);
      if (blob.size > limit) {
        fail(i18n.t('upload.tooLarge', { max: formatBytes(limit) }));
        return;
      }
      const baseName = editorImage.fileName.replace(/\.[^.]+$/, '') || 'product-image';
      const file = new File([blob], `${baseName}.webp`, { type: 'image/webp' });
      if (await upload(file)) resetEdit();
    } catch {
      setEditorError(i18n.t('upload.editFailed'));
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (locked || !editorCanvasRef.current) return;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, offsetX, offsetY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const canvas = editorCanvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const factorX = canvas.width / Math.max(1, bounds.width);
    const factorY = canvas.height / Math.max(1, bounds.height);
    pendingPanRef.current = {
      x: drag.offsetX + (event.clientX - drag.pointerX) * factorX,
      y: drag.offsetY + (event.clientY - drag.pointerY) * factorY,
    };
    if (panFrameRef.current === null) {
      panFrameRef.current = requestAnimationFrame(() => {
        const pan = pendingPanRef.current;
        if (pan) {
          setOffsetX(pan.x);
          setOffsetY(pan.y);
        }
        pendingPanRef.current = null;
        panFrameRef.current = null;
      });
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

  const frame =
    kind === 'product'
      ? 'aspect-[4/3] w-full max-w-md'
      : shape === 'square'
        ? 'aspect-square w-32'
        : 'aspect-[16/9] w-full max-w-md';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-card border-2 border-dashed border-navy-200 bg-navy-50',
          frame,
        )}
      >
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-full w-full object-cover"
          />
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
        {kind === 'product' && canRemove && preview && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void openEditor(preview, 'product-image')}
            disabled={locked}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {i18n.t('upload.edit')}
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

      <p className="text-xs text-navy-500">
        {hint ?? i18n.t('upload.hint', { max: formatBytes(limit) })}
      </p>

      {!canRemove && preview && <p className="text-xs text-navy-500">{i18n.t('upload.externalNotice')}</p>}

      {error && (
        <p role="alert" className="text-sm text-error-600">
          {error}
        </p>
      )}

      {editorImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-navy-950/70 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !locked) resetEdit();
          }}
        >
          <section
            ref={editorDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${fieldId}-editor-title`}
            className="my-auto w-full max-w-2xl rounded-card bg-white p-5 shadow-xl sm:p-7"
          >
            <h2 id={`${fieldId}-editor-title`} className="text-lg font-bold text-navy-900">
              {i18n.t('upload.editTitle')}
            </h2>
            <p className="mt-1 text-sm text-navy-600">{i18n.t('upload.editHint')}</p>
            <div
              className="relative mt-5 aspect-[4/3] w-full overflow-hidden rounded-card border border-navy-200 bg-navy-50"
              style={{
                backgroundImage: 'radial-gradient(#cbd5e1 0.7px, transparent 0.7px)',
                backgroundSize: '16px 16px',
              }}
            >
              <canvas
                ref={editorCanvasRef}
                aria-label={i18n.t('upload.editTitle')}
                width={PRODUCT_IMAGE_MAX_WIDTH}
                height={PRODUCT_IMAGE_HEIGHT}
                className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-navy-700">
                {i18n.t('upload.zoom', { percent: Math.round(zoom * 100) })}
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  disabled={locked}
                  className="mt-2 block w-full accent-primary-600"
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRotation((value) => value - 90)}
                  disabled={locked}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {i18n.t('upload.rotateLeft')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRotation((value) => value + 90)}
                  disabled={locked}
                >
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                  {i18n.t('upload.rotateRight')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                    setOffsetX(0);
                    setOffsetY(0);
                  }}
                  disabled={locked}
                >
                  {i18n.t('upload.resetEdit')}
                </Button>
              </div>
            </div>
            {editorError && (
              <p role="alert" className="mt-3 text-sm text-error-600">
                {editorError}
              </p>
            )}
            {busy && percent !== null && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-navy-100">
                  <div className="h-full bg-primary-600 transition-all duration-200" style={{ width: `${percent}%` }} />
                </div>
                <span className="text-xs text-navy-500">{i18n.t('upload.progress', { percent })}</span>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetEdit} disabled={locked}>
                {i18n.t('common.cancel')}
              </Button>
              <Button type="button" onClick={() => void handleSaveEdit()} loading={busy} disabled={Boolean(editorError)}>
                {i18n.t('upload.saveEdit')}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}