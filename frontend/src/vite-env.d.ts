/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_FACEBOOK_URL?: string;
  readonly VITE_TWITTER_URL?: string;
  readonly VITE_INSTAGRAM_URL?: string;
  readonly VITE_LINKEDIN_URL?: string;
  readonly VITE_COOKIE_POLICY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}