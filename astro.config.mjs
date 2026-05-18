import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://bitsark.com',
  vite: {
    resolve: {
      alias: {
        '@layouts':    fileURLToPath(new URL('./src/layouts', import.meta.url)),
        '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
        '@i18n':       fileURLToPath(new URL('./src/i18n', import.meta.url)),
        '@data':       fileURLToPath(new URL('./src/data', import.meta.url)),
        '@styles':     fileURLToPath(new URL('./src/styles', import.meta.url)),
        '@lib':        fileURLToPath(new URL('./src/lib', import.meta.url)),
      },
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'pt'],            // 'pt' mapeia para /pt/ nas URLs
    routing: {
      prefixDefaultLocale: false,     // EN fica na raiz, PT fica em /pt/
    },
    fallback: {
      pt: 'en',                       // Se página PT não existe, serve EN sem 404
    },
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/404') &&
        !page.includes('/dolarmap/privacy') &&
        !page.includes('/dolarmap/terms') &&
        !page.includes('/dolarmap/support'),
      // i18n passado explicitamente para o integration gerar <xhtml:link rel="alternate" hreflang="..."> em cada URL.
      i18n: {
        defaultLocale: 'en',
        locales: {
          en:    'en',
          pt:    'pt-BR',
        },
      },
    }),
  ],
});