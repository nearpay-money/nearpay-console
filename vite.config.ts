import { defineConfig, type Plugin } from "vite";

/**
 * Content-Security-Policy of the built index.html (lld/dashboard-and-console.md §2; ADR-0010 posture).
 * The console loads nothing but its own bundle: no wallets, no Turnstile, no third-party origins, so
 * there is no nonce and no 'unsafe-inline' anywhere (styles come only from the bundled CSS files; the
 * UI never renders `style=""`). API calls stay same-origin (`ops.<domain>/api`). nginx adds
 * `frame-ancestors 'none'` as a header (deploy/nginx.conf). Dev mode (vite serve) gets no CSP.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function csp(): Plugin {
  return {
    name: "nearpay-console-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [csp()],
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    target: "es2022",
    // never inline assets as data: URIs (img-src / font-src are 'self' only)
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // local development against the Compose stack: same-origin /api like production
    proxy: { "/api": { target: "https://ops.nearpay.localhost", changeOrigin: true, secure: false } },
  },
  preview: { port: 4190, strictPort: true },
});
