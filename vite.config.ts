import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://<user>.github.io/teleprompter/, so every asset URL needs
  // the repo name prefix. Keep in sync with the repo name if it is ever renamed.
  base: '/teleprompter/',
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a new service worker must WAIT rather than
      // skipWaiting+clientsClaim its way into every open window. Auto-claiming was
      // firing `controllerchange` in the live talent-display window and reloading
      // it mid-take — a blank screen that ends a recording. Updates now apply only
      // when all tabs are closed and reopened. The operator console still self-heals
      // a genuinely stale chunk via installUpdateHandling(); the display never does.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'fonts/*.woff2'],
      manifest: {
        name: 'autocue',
        short_name: 'autocue',
        description: 'autocue teleprompter for video production',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'landscape',
        scope: '/teleprompter/',
        start_url: '/teleprompter/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + all local assets (incl. bundled fonts) precached for full offline use on set.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Activate a new worker immediately rather than leaving it waiting
        // behind an open tab. Without this a deploy can leave the page running
        // an old shell whose hashed chunks the server has already deleted — see
        // lib/appUpdate.ts, which reloads when this claim happens.
        skipWaiting: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Listen on all network interfaces so others on the same network can reach
    // the dev server at http://<this-machine-ip>:5173 (not just localhost).
    host: true,
  },
})
