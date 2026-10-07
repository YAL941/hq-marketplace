export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 500 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}
