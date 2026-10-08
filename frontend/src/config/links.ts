/**
 * External links the chrome renders.
 *
 * An empty string means "not configured": the link is not
 * rendered at all. A `#` placeholder is never shown, because
 * a footer link that goes nowhere looks like a broken site.
 *
 * Fill these in at build time with the matching VITE_*
 * variables, or edit the values directly.
 */
export const SOCIAL_LINKS = [
  { network: 'facebook', url: import.meta.env.VITE_FACEBOOK_URL ?? '' },
  { network: 'twitter', url: import.meta.env.VITE_TWITTER_URL ?? '' },
  { network: 'instagram', url: import.meta.env.VITE_INSTAGRAM_URL ?? '' },
  { network: 'linkedin', url: import.meta.env.VITE_LINKEDIN_URL ?? '' },
] as const;

/** The cookie policy page. Empty means the footer link is not rendered. */
export const COOKIE_POLICY_URL = import.meta.env.VITE_COOKIE_POLICY_URL ?? '';
