/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOTJAR_SITE_ID?: string;
  readonly VITE_HOTJAR_VERSION?: string;
  readonly VITE_ENABLE_HOTJAR_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
