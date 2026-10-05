import { ReactNode, useEffect, useState } from 'react';
import { resolveMediaUrl } from '../../lib/media';

export interface SmartImageProps {
  /** The stored value exactly as the database holds it: a path or an absolute URL. */
  value: string | null | undefined;
  /**
   * Empty whenever the name is already on screen next to the image.
   *
   * A logo beside its business name is decoration; announcing it again would
   * make a screen reader read the same thing twice. Pass text only when the image
   * is the only thing naming its subject.
   */
  alt?: string;
  /**
   * Intrinsic dimensions in pixels.
   *
   * They are the browser's reservation for the image before it arrives, which is
   * what keeps the surrounding layout from jumping when it does. The box they
   * sit in is normally sized in CSS; these are the fallback for the moment in
   * between, not the visible size.
   */
  width: number;
  height: number;
  className?: string;
  /** Drawn when there is no image, or when the one there fails to load. */
  fallback: ReactNode;
  /**
   * Skips `loading="lazy"` and `decoding="async"`.
   *
   * Only for an image that is in the first viewport — a lazy image above the fold
   * delays the one thing the visitor came for, and an async decode on a large
   * hero can visibly outrun the paint.
   */
  eager?: boolean;
}

/**
 * An `<img>` that knows the two ways an image can be absent.
 *
 * There is no image, which the caller already knows and answers with a
 * placeholder; and there is an image whose bytes never arrive — a stored path
 * pointing at a file that was deleted outside the app, a URL on a host that has
 * gone away. The second is the reason this component exists. Without handling
 * it, a failed load leaves the browser's own broken-image marker sitting in the
 * layout, which looks like a bug in the product rather than a missing file.
 *
 * Every image in the app goes through here so that `resolveMediaUrl` is applied
 * exactly once per render and no screen invents its own URL handling.
 */
export function SmartImage({
  value,
  alt = '',
  width,
  height,
  className,
  fallback,
  eager = false,
}: SmartImageProps) {
  const [failed, setFailed] = useState(false);
  const src = resolveMediaUrl(value);

  // Cleared whenever the URL changes. A placeholder has to be able to recover:
  // without this, one bad file would leave the component permanently on its
  // fallback even after the owner replaced the image with a good one.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? undefined : 'lazy'}
      decoding={eager ? undefined : 'async'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}