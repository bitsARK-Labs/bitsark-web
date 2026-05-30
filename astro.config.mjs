import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import sitemap from '@astrojs/sitemap';
import compress from '@playform/compress';

/**
 * Sitemap "gold standard" 2025 - helpers para o serialize().
 *
 * Objetivos:
 *  - <lastmod> real por URL (Google usa como sinal de re-crawl prioritário
 *    desde 2023). Derivado da data do último commit que tocou o arquivo-fonte.
 *  - hreflang x-default em cada <url>, apontando para a variante EN. Sem isso,
 *    o Search Console marca "missing default" para sites com múltiplos idiomas.
 *  - SEM <priority> e SEM <changefreq>: Google ignora ambos desde 2017; manter
 *    no XML é code smell.
 */

/** Constrói um Map<file-path, ISO-date> em UMA passada de `git log`. */
function buildGitLastmodMap() {
  try {
    const raw = execSync(
      'git log --name-only --pretty=format:__COMMIT__%aI',
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    const map = new Map();
    let currentDate = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('__COMMIT__')) {
        currentDate = line.slice('__COMMIT__'.length);
      } else if (line && currentDate && !map.has(line)) {
        // primeira ocorrência = commit mais recente (git log é DESC por padrão)
        map.set(line, currentDate);
      }
    }
    return map;
  } catch (err) {
    console.warn('[sitemap] git unavailable, lastmod fallback to build time:', err.message);
    return new Map();
  }
}

const GIT_LASTMOD = buildGitLastmodMap();
const BUILD_TIME_ISO = new Date().toISOString();

/** HEAD commit como fallback final (sempre disponível em qualquer checkout). */
const HEAD_DATE = (() => {
  try {
    return execSync('git log -1 --format=%aI', { encoding: 'utf8' }).trim();
  } catch {
    return BUILD_TIME_ISO;
  }
})();

/** URL pública → candidatos a arquivos-fonte. Pega a data MAIS RECENTE entre eles. */
function sourceCandidatesFor(url) {
  const pathname = new URL(url).pathname.replace(/^\/|\/$/g, '');

  // Home
  if (pathname === '')   return ['src/pages/index.astro'];
  if (pathname === 'pt') return ['src/pages/pt/index.astro'];

  const isPt = pathname.startsWith('pt/');
  const cleanPath = isPt ? pathname.slice(3) : pathname;
  const prefix = isPt ? 'src/pages/pt/' : 'src/pages/';

  const candidates = [
    `${prefix}${cleanPath}.astro`,
    `${prefix}${cleanPath}/index.astro`,
  ];

  // Rotas dinâmicas /exchanges/<slug>/: o conteúdo vem do template + dataset
  if (/^exchanges\/[^/]+$/.test(cleanPath)
      && !['exchanges/api', 'exchanges/decripto'].includes(cleanPath)) {
    candidates.push(
      `${prefix}exchanges/[slug].astro`,
      'src/data/exchanges.json',
    );
  }

  // Páginas que dependem do dataset de stablecoins
  if (cleanPath.startsWith('stablecoins-brasil')) {
    candidates.push('public/data/stablecoin-market.json');
    candidates.push('public/data/stablecoin-brazil.json');
  }

  return candidates;
}

function lastmodForUrl(url) {
  let latest = null;
  for (const p of sourceCandidatesFor(url)) {
    const date = GIT_LASTMOD.get(p);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest || HEAD_DATE;
}

export default defineConfig({
  site: 'https://bitsark.com',
  /**
   * trailingSlash: 'always' - alinha o roteamento ao formato de saída do build
   * (directory format: /exchanges/index.html → URL canônica /exchanges/) e às
   * <link rel="canonical"> e ao sitemap, que já usam barra final.
   *
   * Sem isso (default 'ignore'), links internos sem barra (href="/exchanges")
   * batiam no redirect 308 automático do Cloudflare Pages (/exchanges →
   * /exchanges/), gerando "internal redirects from trailing slash mismatch"
   * no SiteChecker e desperdiçando crawl budget + link equity.
   *
   * REGRA para novos links internos: SEMPRE termine com barra (href="/foo/").
   * O helper l() em Base.astro/MobileMenu.astro normaliza isso automaticamente.
   */
  trailingSlash: 'always',
  image: {
    // Sharp is the default; pinning it here documents the intent and
    // unblocks future tuning (e.g. raising AVIF effort).
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
  build: {
    /**
     * Inline TODO o CSS no <head> da página.
     * Trade-off:
     *   + Elimina 100% do render-blocking CSS (300ms+ de savings no LCP).
     *   + Zero round-trips na critical path.
     *   - HTML cresce ~16 KiB por página; perda de cache cross-page do CSS.
     * Para um site marketing com bounce-rate alto e first-visit dominante,
     * o ganho de LCP supera a perda de cache. Em sites com retorno alto,
     * preferir 'auto' (default: inline < 4KB, link o resto).
     */
    inlineStylesheets: 'always',
  },
  vite: {
    build: {
      cssCodeSplit: true,
    },
    resolve: {
      alias: {
        '@layouts':    fileURLToPath(new URL('./src/layouts', import.meta.url)),
        '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
        '@i18n':       fileURLToPath(new URL('./src/i18n', import.meta.url)),
        '@data':       fileURLToPath(new URL('./src/data', import.meta.url)),
        '@styles':     fileURLToPath(new URL('./src/styles', import.meta.url)),
        '@lib':        fileURLToPath(new URL('./src/lib', import.meta.url)),
        '@assets':     fileURLToPath(new URL('./src/assets', import.meta.url)),
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
        !page.includes('/dolarmap/support') &&
        !page.includes('/terms'),
      // i18n passado explicitamente para o integration gerar <xhtml:link rel="alternate" hreflang="..."> em cada URL.
      i18n: {
        defaultLocale: 'en',
        locales: {
          en:    'en',
          pt:    'pt-BR',
        },
      },
      /**
       * serialize() roda por URL antes da serialização XML.
       *  1. Injeta <lastmod> derivado do git (sinal de re-crawl)
       *  2. Adiciona hreflang="x-default" apontando para a variante EN
       *
       * Não emitimos priority/changefreq por design (Google ignora desde 2017).
       */
      serialize(item) {
        item.lastmod = lastmodForUrl(item.url);

        if (Array.isArray(item.links) && item.links.length > 0) {
          const enLink = item.links.find((l) => l.lang === 'en');
          const hasXDefault = item.links.some((l) => l.lang === 'x-default');
          if (enLink && !hasXDefault) {
            item.links.push({ lang: 'x-default', url: enLink.url });
          }
        }

        return item;
      },
    }),
    /**
     * Remove comentários HTML (<!-- -->) do output do build.
     *
     * Motivo: comentários de markup viajam no HTML servido ao cliente e contam
     * como payload inútil. Auditorias (SiteChecker etc.) sinalizam "comments in
     * code". No baseline mediam ~452 KiB (3,7% do HTML) distribuídos pelas
     * páginas - a maioria vinda dos blocos de documentação repetidos via layout.
     *
     * IMPORTANTE: isto NÃO afeta comentários no frontmatter `---` (JS/TS) nem em
     * <style> - esses já não chegam ao cliente. Só limpa os <!-- --> do HTML
     * final. Documentação de engenharia nos .astro permanece intacta no source.
     *
     * Escopo deliberadamente mínimo: só HTML. CSS/JS já são minificados pelo
     * Vite; imagens pelo Sharp. Ligar os outros aqui seria redundante e
     * arriscaria conflito. O default do html-minifier-terser neste pacote é
     * apenas { removeComments: true, removeAttributeQuotes: false } - sem
     * collapseWhitespace (o Astro já trata via compressHTML).
     *
     * Deve ser o ÚLTIMO integration: roda sobre o dist/ já gerado (inclusive o
     * HTML emitido pelo sitemap não é afetado; só *.html de páginas).
     */
    compress({
      HTML: true,
      CSS: false,
      JavaScript: false,
      Image: false,
      SVG: false,
      Logger: 0,
    }),
  ],
});