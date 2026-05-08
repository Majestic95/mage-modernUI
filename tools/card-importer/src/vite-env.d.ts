/// <reference types="vite/client" />

declare namespace React {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}

interface Window {
  __TAURI_INTERNALS__?: unknown;
}
