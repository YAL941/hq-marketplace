/**
 * Where a stored image URL has to point, in the browser.
 *
 * The database keeps an image as one of two things, and every component in the
 * app that renders one goes through this file so it never has to know which:
 *
 *   * a path the API produced, `/uploads/<businessId>/<slot>/<name>.webp`, or
 *   * an external `http(s)` URL an owner typed in by hand.
 *
 * A path is returned as it is in development, because the Vite dev server
 * proxies `/uploads` to the API and the browser therefore sees a same-origin
 * URL. In a deployment where the images are served from a different origin — a
 * CDN, or the API on its own host — `VITE_MEDIA_BASE` is set to that origin's
 * prefix and the path is joined onto it.
 *
 * Absolute URLs are returned untouched. That is what makes the two coexist: a
 * row that predates the switch to a CDN keeps working, and a row written after
 * it already carries a full URL, with nothing in the UI having to be rewritten.
 */

import i18n from '../i18n';
import type { FieldIssue } from '../services/api';
import { formatBytes } from './utils';

/** The origin/prefix a stored path is resolved against. Empty means same origin. */
const MEDIA_BASE = (import.meta.env.VITE_MEDIA_BASE ?? '').replace(/\/+$/, '');

/** True for a full URL, whatever its scheme. */
function isAbsolute(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * The URL to put in an `<img src>`.
 *
 * Null and empty both mean "no image", and both return null rather than an empty
 * string, so a caller can write `const src = resolveMediaUrl(row.logo_url)` and
 * branch on it instead of also testing the raw value.
 */
export function resolveMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // data:, blob: and every other absolute form is already usable as-is. A
  // protocol-relative "//host/path" is absolute too, and needs no base.
  if (isAbsolute(trimmed) || trimmed.startsWith('//')) return trimmed;

  // Already prefixed by VITE_MEDIA_BASE, either by a caller or by a stored value
  // that was written after the base changed. Prefixing twice would produce
  // `https://cdn.example/https://cdn.example/...`.
  if (MEDIA_BASE && trimmed.startsWith(`${MEDIA_BASE}/`)) return trimmed;

  return `${MEDIA_BASE}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}

/**
 * True when the value is a path this API produced, as opposed to an external
 * link.
 *
 * This is what decides whether "Remove" means "delete the file" or "just clear
 * the column": the delete endpoints only remove a managed file, so the button
 * is not offered for a value the API does not own.
 */
export function isManagedUpload(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (isAbsolute(trimmed) || trimmed.startsWith('//')) return false;
  return /^\/uploads\/\d+\/(?:logo|cover|products\/\d+)\/[0-9a-f]{32}\.webp$/.test(trimmed);
}

/** The public URL prefix the API serves stored files under. */
export const UPLOADS_PREFIX = '/uploads/';

/**
 * Upload ceilings, in bytes, mirroring the server's defaults.
 *
 * They exist only to answer before a multi-megabyte upload starts, and the
 * server stays the authority: these numbers are duplicated on purpose, so if
 * one side changes without the other the worst outcome is that a file is
 * refused locally and accepted on retry, rather than the reverse — an upload
 * that the browser believed was fine and the API then truncated.
 */
export const UPLOAD_LIMITS = {
  logo: 2 * 1024 * 1024,
  cover: 5 * 1024 * 1024,
  product: 5 * 1024 * 1024,
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;

/** The `accept` attribute value: what the file picker offers. */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * The client-side type check.
 *
 * `image/svg+xml` is absent from the accepted list and must stay absent: SVG is
 * XML that a browser will happily execute script from, and the server refuses it
 * on purpose. This narrows what the picker offers; it does not decide what is
 * accepted, which is why the server reads the bytes as well.
 */
export function isAcceptableImageType(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp';
}

/**
 * Turns a failed media request into a sentence in the active language.
 *
 * The server's messages are English and specific, which is the right default:
 * an unrecognised code still produces readable text rather than a bare "failed".
 * The four codes that recur on these routes are translated instead, because they
 * are the ones a person sees most and are the least self-explanatory in a
 * language they are reading.
 *
 * `fallbackBytes` is the ceiling this client knew about, used only when the
 * server did not send one. When it does send `maxBytes`, that number wins: the
 * message then names the limit that was actually enforced rather than the one
 * that happened to be compiled into the bundle.
 */
export function describeMediaIssue(issue: FieldIssue, fallbackBytes: number): string {
  const serverText = issue.message || i18n.t('upload.failed');
  const ceiling = formatBytes(issue.maxBytes ?? fallbackBytes);

  switch (issue.code) {
    case 'UNSUPPORTED_IMAGE_TYPE':
      return i18n.t('upload.unsupportedType');
    case 'FILE_TOO_LARGE':
      return i18n.t('upload.tooLarge', { max: ceiling });
    case 'IMAGE_TOO_LARGE':
      return i18n.t('upload.tooLargeDimensions');
    case 'RATE_LIMITED':
      return i18n.t('errors.rateLimited');
    default:
      // 403 is checked before `code` because the permission middleware and the
      // business resolver emit it under different codes (`FORBIDDEN` and
      // `UNAUTHORIZED`-adjacent paths), and both mean the same thing here: this
      // account may not change this image. A pending or rejected business is
      // still editable by its staff, so this is about the account's role, not
      // about the business being visible.
      if (issue.status === 403) return i18n.t('errors.forbidden');
      if (issue.status === 429) return i18n.t('errors.rateLimited');
      return serverText;
  }
}