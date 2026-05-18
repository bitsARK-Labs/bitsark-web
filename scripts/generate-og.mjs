/**
 * generate-og.mjs - Pre-build static OG images for social sharing.
 *
 * Generates 1200×630 PNGs:
 *   - public/og-default.png            (site-wide fallback)
 *   - public/og/exchanges/<slug>.png   (one per exchange)
 *   - public/og/<page>.png             (key marketing pages)
 *
 * Renders via satori (HTML → SVG) + @resvg/resvg-js (SVG → PNG). Runs
 * once at build time on GitHub Actions / Cloudflare Pages - zero runtime cost.
 *
 * Re-run manually with: `node scripts/generate-og.mjs`
 * Hooked into npm `prebuild` so it always runs before `astro build`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'og');
const exchanges = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'exchanges.json'), 'utf8')
);

// ── Brand tokens (mirror src/styles/global.css) ─────────────────────────
const BRAND = {
  bg:        '#0f1012',
  surface:   '#161719',
  surface2:  '#1c1e21',
  text:      '#d8d9db',
  textMuted: '#949ba6',
  textFaint: '#5a6070',
  primary:   '#4f98a3',
  accent:    '#e8af34',
  success:   '#6daa45',
  border:    'rgba(79, 152, 163, 0.20)',
};

// ── Fonts (TTF - Geist via npm `geist`) ─────────────────────────────────
const fontRegular = readFileSync(
  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf')
);
const fontMedium = readFileSync(
  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf')
);
const fontBold = readFileSync(
  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf')
);
const fontMono = readFileSync(
  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf')
);

const fonts = [
  { name: 'Geist',      data: fontRegular, weight: 400, style: 'normal' },
  { name: 'Geist',      data: fontMedium,  weight: 500, style: 'normal' },
  { name: 'Geist',      data: fontBold,    weight: 700, style: 'normal' },
  { name: 'Geist Mono', data: fontMono,    weight: 500, style: 'normal' },
];

// ── React.createElement-style helper (no JSX needed) ────────────────────
function h(type, props = {}, ...children) {
  return { type, props: { ...props, children: children.flat() } };
}

// ── Brand wordmark for top of every OG ──────────────────────────────────
function Wordmark() {
  return h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 0 } },
    h('span', { style: { color: BRAND.text,    fontSize: 36, fontWeight: 700 } }, 'bits'),
    h('span', { style: { color: BRAND.primary, fontSize: 36, fontWeight: 700 } }, 'ARK'),
    h('span', { style: { color: BRAND.textMuted, fontSize: 24, fontWeight: 500, marginLeft: 8 } }, 'Labs'),
  );
}

// ── Subtle grid backdrop (tech feel) ────────────────────────────────────
function Backdrop() {
  // Simple radial vignette over the brand bg
  return h('div', {
    style: {
      position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex',
      background: `radial-gradient(circle at 100% 0%, ${BRAND.primary}1a 0%, transparent 50%), ${BRAND.bg}`,
    },
  });
}

// ── Footer URL pill ─────────────────────────────────────────────────────
function UrlPill(url) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'Geist Mono', fontSize: 18, color: BRAND.textMuted,
    },
  },
    h('span', { style: { color: BRAND.primary } }, '→'),
    h('span', null, url),
  );
}

// ── Default site OG ─────────────────────────────────────────────────────
function DefaultTemplate() {
  return h('div', {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      padding: '64px 72px', position: 'relative', color: BRAND.text,
      fontFamily: 'Geist', background: BRAND.bg,
    },
  },
    Backdrop(),
    h('div', { style: { display: 'flex', position: 'relative' } }, Wordmark()),
    h('div', {
      style: {
        display: 'flex', flexDirection: 'column', flexGrow: 1,
        justifyContent: 'center', position: 'relative', gap: 28,
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em',
          maxWidth: 980,
        },
      }, 'Open data infrastructure for the Brazilian crypto market.'),
      h('div', {
        style: {
          display: 'flex', gap: 16, fontSize: 22, color: BRAND.textMuted,
          fontFamily: 'Geist Mono',
        },
      },
        h('span', { style: { color: BRAND.primary } }, 'DolarMap'),
        h('span', null, '·'),
        h('span', { style: { color: BRAND.primary } }, 'Exchanges API'),
        h('span', null, '·'),
        h('span', { style: { color: BRAND.primary } }, 'Stablecoins'),
      ),
    ),
    h('div', {
      style: { display: 'flex', justifyContent: 'flex-end', position: 'relative' },
    }, UrlPill('bitsark.com')),
  );
}

// ── Exchange OG ─────────────────────────────────────────────────────────
function ExchangeTemplate(ex) {
  const isOffshore = ex.fiscal_details_br?.tax_regime === 'offshore_law_14754';
  const isBcbAuthorized = ex.operational_details_br?.bcb_authorized === true;
  const acceptsPix = ex.operational_details_br?.accepts_pix === true;
  const jurisdiction = ex.operational_details_br?.main_jurisdiction_iso || '-';

  const maker = ex.fees?.maker;
  const taker = ex.fees?.taker;
  const formatFee = (v) =>
    v == null ? '-' : v === 0 ? '0.00%' : `${(v * 100).toFixed(2)}%`;

  const chipBg    = isOffshore ? `${BRAND.accent}1a` : `${BRAND.success}1a`;
  const chipText  = isOffshore ? BRAND.accent       : BRAND.success;
  const chipLabel = isOffshore ? 'Offshore · Lei 14.754' : 'Domestic · Brazilian regime';

  const tags = [];
  if (isBcbAuthorized) tags.push('BCB authorized');
  if (acceptsPix)      tags.push('Accepts Pix');
  tags.push(`Jurisdiction · ${jurisdiction}`);

  return h('div', {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      padding: '60px 72px', position: 'relative', color: BRAND.text,
      fontFamily: 'Geist', background: BRAND.bg,
    },
  },
    Backdrop(),
    // Header
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative',
      },
    },
      Wordmark(),
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'Geist Mono', fontSize: 18, color: BRAND.textMuted,
        },
      },
        h('span', { style: { color: BRAND.primary } }, '/'),
        h('span', null, 'exchanges'),
      ),
    ),
    // Body
    h('div', {
      style: {
        display: 'flex', flexDirection: 'column', flexGrow: 1,
        justifyContent: 'center', gap: 24, position: 'relative',
      },
    },
      h('div', {
        style: {
          display: 'flex',
          fontSize: 90, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.025em',
        },
      }, ex.name),
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 14,
        },
      },
        h('span', {
          style: {
            display: 'flex', padding: '8px 16px',
            background: chipBg, color: chipText,
            borderRadius: 999, fontSize: 18, fontWeight: 500,
            border: `1px solid ${chipText}40`,
          },
        }, chipLabel),
      ),
      // Fees
      h('div', {
        style: {
          display: 'flex', gap: 32, marginTop: 12,
          fontFamily: 'Geist Mono',
        },
      },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('span', { style: { fontSize: 15, color: BRAND.textFaint, letterSpacing: '0.05em' } }, 'MAKER'),
          h('span', { style: { fontSize: 32, color: BRAND.text, fontWeight: 500 } }, formatFee(maker)),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('span', { style: { fontSize: 15, color: BRAND.textFaint, letterSpacing: '0.05em' } }, 'TAKER'),
          h('span', { style: { fontSize: 32, color: BRAND.text, fontWeight: 500 } }, formatFee(taker)),
        ),
      ),
      // Tags
      h('div', {
        style: {
          display: 'flex', gap: 12, fontSize: 16, color: BRAND.textMuted,
          fontFamily: 'Geist Mono',
        },
      },
        ...tags.flatMap((tag, i) => {
          const items = [h('span', { key: tag }, tag)];
          if (i < tags.length - 1) items.push(h('span', { key: `sep-${i}`, style: { color: BRAND.textFaint } }, '·'));
          return items;
        }),
      ),
    ),
    // Footer URL
    h('div', {
      style: { display: 'flex', justifyContent: 'flex-end', position: 'relative' },
    }, UrlPill(`bitsark.com/exchanges/${ex.slug}`)),
  );
}

// ── Generic page OG (DolarMap, Stablecoins, DeCripto, etc) ──────────────
function PageTemplate({ eyebrow, title, subtitle, url, accent = BRAND.primary }) {
  return h('div', {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      padding: '64px 72px', position: 'relative', color: BRAND.text,
      fontFamily: 'Geist', background: BRAND.bg,
    },
  },
    Backdrop(),
    h('div', { style: { display: 'flex', position: 'relative' } }, Wordmark()),
    h('div', {
      style: {
        display: 'flex', flexDirection: 'column', flexGrow: 1,
        justifyContent: 'center', gap: 22, position: 'relative',
      },
    },
      eyebrow && h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
          padding: '6px 14px', borderRadius: 999,
          background: `${accent}14`, color: accent,
          border: `1px solid ${accent}40`,
          fontSize: 16, fontFamily: 'Geist Mono',
        },
      },
        h('span', { style: { width: 6, height: 6, borderRadius: 999, background: accent, display: 'flex' } }),
        h('span', null, eyebrow),
      ),
      h('div', {
        style: {
          display: 'flex',
          fontSize: 78, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em',
          maxWidth: 1000,
        },
      }, title),
      subtitle && h('div', {
        style: { display: 'flex', fontSize: 26, color: BRAND.textMuted, lineHeight: 1.4, maxWidth: 960 },
      }, subtitle),
    ),
    h('div', {
      style: { display: 'flex', justifyContent: 'flex-end', position: 'relative' },
    }, UrlPill(url)),
  );
}

// ── Render helpers ──────────────────────────────────────────────────────
async function renderToPng(node, outPath) {
  const svg = await satori(node, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(`[og] generating images → ${OUT_DIR.replace(ROOT, '.')}/`);

  // 1. Default site OG (also writes /public/og-default.png at the public root)
  await renderToPng(DefaultTemplate(), join(ROOT, 'public', 'og-default.png'));
  console.log('[og]   ✓ og-default.png');

  // 2. Exchange OGs
  mkdirSync(join(OUT_DIR, 'exchanges'), { recursive: true });
  for (const ex of exchanges) {
    await renderToPng(ExchangeTemplate(ex), join(OUT_DIR, 'exchanges', `${ex.slug}.png`));
    console.log(`[og]   ✓ exchanges/${ex.slug}.png`);
  }

  // 3. Key marketing pages
  const pages = [
    {
      slug: 'dolarmap',
      eyebrow: 'DolarMap',
      title: 'Real-time USD/BRL across every Brazilian exchange.',
      subtitle: 'Live rates · Alerts · Arbitrage · Stablecoins comparison.',
      accent: BRAND.primary,
    },
    {
      slug: 'exchanges',
      eyebrow: 'Exchanges Directory',
      title: 'Every Brazilian crypto exchange - fees, regulation, Pix.',
      subtitle: 'BCB licensing · DeCripto · DARF guidance.',
      accent: BRAND.primary,
    },
    {
      slug: 'stablecoins-brasil',
      eyebrow: 'Stablecoins Brasil',
      title: 'Brazil is the largest stablecoin economy in Latin America.',
      subtitle: 'Live data from CoinGecko · Banco Central do Brasil.',
      accent: BRAND.success,
    },
    {
      slug: 'decripto',
      eyebrow: 'DeCripto · IN 2.291/2025',
      title: 'Brazil’s new crypto tax reporting rules take effect July 2026.',
      subtitle: 'Definitive guide for users, investors, and accountants.',
      accent: BRAND.accent,
    },
    {
      slug: 'exchanges-api',
      eyebrow: 'Exchanges API',
      title: 'Free, public REST API for Brazilian exchange data.',
      subtitle: 'Fees · Regulation · CNPJ · Updated weekly.',
      accent: BRAND.primary,
    },
  ];

  for (const p of pages) {
    await renderToPng(
      PageTemplate({ ...p, url: `bitsark.com/${p.slug === 'decripto' ? 'exchanges/decripto' : p.slug}` }),
      join(OUT_DIR, `${p.slug}.png`)
    );
    console.log(`[og]   ✓ ${p.slug}.png`);
  }

  console.log(`[og] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[og] FAILED:', err);
  process.exit(1);
});
