/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOTJAR_SITE_ID?: string;
  readonly VITE_HOTJAR_VERSION?: string;
  readonly VITE_ENABLE_HOTJAR_DEBUG?: string;
  readonly VITE_MIXPANEL_TOKEN?: string;
  readonly NEXT_PUBLIC_MIXPANEL_TOKEN?: string;
  readonly VITE_MIXPANEL_EU_RESIDENCY?: string;
  readonly NEXT_PUBLIC_MIXPANEL_EU_RESIDENCY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
