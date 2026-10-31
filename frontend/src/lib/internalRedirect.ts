function decodedForValidation(value: string): string | null {
  let current = value;

  for (let index = 0; index < 3; index += 1) {
    if (/%(?![0-9a-fA-F]{2})/.test(current)) return null;

    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      return null;
    }
  }

  return current;
}

export function getSafeInternalRedirect(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return fallback;
  }

  const decoded = decodedForValidation(value);
  if (!decoded) return fallback;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return fallback;
  if (decoded.includes('\\')) return fallback;
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  const rawSegments = decoded.split(/[/?#]/);
  if (rawSegments.some((segment) => segment === '.' || segment === '..')) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(decoded, 'https://hq-marketplace.invalid');
  } catch {
    return fallback;
  }

  if (parsed.origin !== 'https://hq-marketplace.invalid') return fallback;
  if (parsed.username || parsed.password || parsed.hostname !== 'hq-marketplace.invalid') {
    return fallback;
  }

  const segments = parsed.pathname.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
