/**
 * Control characters have no business in a URL: they are invisible
 * and would otherwise pass straight through to a redirect or a
 * request. Checked by code point rather than with a regex, so the
 * range stays readable.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 500 || value !== value.trim() || hasControlCharacter(value)) {
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
