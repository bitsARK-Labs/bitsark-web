/**
 * patch-sitemap-index.mjs
 *
 * @astrojs/sitemap v3 não emite <lastmod> no sitemap-index.xml. Google [aceita
 * lastmod no nível do index](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)
 * e o trata como sinal de re-crawl para o conjunto inteiro.
 *
 * Estratégia: lastmod do index = MAX(lastmod das URLs filhas). Mais honesto
 * que "build time" (que mente quando nada mudou).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const INDEX_PATH = resolve(DIST, 'sitemap-index.xml');

if (!existsSync(INDEX_PATH)) {
  console.warn('[postbuild] sitemap-index.xml not found - skipping patch');
  process.exit(0);
}

const indexXml = readFileSync(INDEX_PATH, 'utf8');

// Coleta lastmod de TODOS os sitemap-N.xml referenciados
const childUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let maxLastmod = null;

for (const childUrl of childUrls) {
  // sitemap-0.xml etc são gerados em dist/, mesmo nome do trecho final da URL
  const filename = childUrl.split('/').pop();
  const childPath = resolve(DIST, filename);
  if (!existsSync(childPath)) continue;

  const childXml = readFileSync(childPath, 'utf8');
  for (const m of childXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    if (!maxLastmod || m[1] > maxLastmod) maxLastmod = m[1];
  }
}

if (!maxLastmod) {
  console.warn('[postbuild] no <lastmod> found in child sitemaps - skipping');
  process.exit(0);
}

// Injeta <lastmod> após cada <loc> que ainda não tenha
const patched = indexXml.replace(
  /(<sitemap><loc>[^<]+<\/loc>)(?!<lastmod>)/g,
  `$1<lastmod>${maxLastmod}</lastmod>`,
);

if (patched === indexXml) {
  console.log('[postbuild] sitemap-index already has lastmod - no change');
  process.exit(0);
}

writeFileSync(INDEX_PATH, patched, 'utf8');
console.log(`[postbuild] sitemap-index.xml patched with lastmod=${maxLastmod}`);
