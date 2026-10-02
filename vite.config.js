import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { host: true },
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'] },
      manifest: {
        name: '2qo — offline chat, voice AI & SOS',
        short_name: '2qo',
        description: 'Offline-first messaging with an on-device voice AI and Nigerian postcode intelligence.',
        theme_color: '#5b3df5',
        background_color: '#0e0c18',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['social', 'communication', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'SOS', url: '/?go=sos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: '2qo AI', url: '/?go=ai', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
        share_target: { action: '/?share=1', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
      },
    }),
  ],
});
