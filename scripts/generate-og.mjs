/**
 * generate-og.mjs - Pre-build static OG images for social sharing.
 *
 * Generates 1200×630 PNGs:
 *   - public/og-default.png            (site-wide fallback)
 *   - public/og/exchanges/<slug>.png   (one per exchange)
 *   - public/og/<page>.png             (key marketing pages)
 *
 * Design system: "Linear/Resend bold tech" — gradient mesh backdrop,
 * blueprint grid overlay, monospace metadata bars, abstract data
 * signatures (sparklines / bar trios / dot clouds / code blocks /
 * calendar marks). All decorative SVG is rasterized to PNG via Resvg
 * (satori cannot render inline SVG), cached as data URLs at boot.
 *
 * Renders via satori (HTML → SVG) + @resvg/resvg-js (SVG → PNG). Runs
 * once at build time on GitHub Actions / Cloudflare Pages - zero runtime cost.
 *
 * Re-run manually with: `node scripts/generate-og.mjs`
 * Hooked into npm `prebuild` so it always runs before `astro build`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'og');
const CACHE_DIR = resolve(ROOT, '.cache', 'og-assets');
mkdirSync(CACHE_DIR, { recursive: true });

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
  borderStrong: 'rgba(79, 152, 163, 0.35)',
};

const VERSION_TAG = 'v2026.05';

// ── Font paths (Geist via npm `geist`) ──────────────────────────────────
const FONT_PATHS = {
  sansRegular:  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf'),
  sansMedium:   resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf'),
  sansSemibold: resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf'),
  sansBold:     resolve(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf'),
  monoRegular:  resolve(ROOT, 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf'),
  monoMedium:   resolve(ROOT, 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf'),
  monoBold:     resolve(ROOT, 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf'),
};

// Resvg font config — needed for SVG <text> rendering in decorative assets
const RESVG_FONT = {
  fontFiles: Object.values(FONT_PATHS).filter((p) => existsSync(p)),
  loadSystemFonts: false,
  defaultFontFamily: 'Geist',
  sansSerifFamily: 'Geist',
  monospaceFamily: 'Geist Mono',
};

// ── Pre-rasterize SVG → PNG → data URL (satori only renders SVG via <img>) ──
function svgToDataUrl(svgString, width) {
  const opts = { background: 'rgba(0,0,0,0)', font: RESVG_FONT };
  if (width) opts.fitTo = { mode: 'width', value: width };
  const png = new Resvg(Buffer.from(svgString), opts).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

// ── Download remote exchange logo (SVG), rasterize, cache on disk ───────
async function fetchExchangeLogo(slug, url) {
  const cachePath = join(CACHE_DIR, `${slug}.png`);
  if (existsSync(cachePath)) {
    return `data:image/png;base64,${readFileSync(cachePath).toString('base64')}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[og] logo fetch ${slug} → HTTP ${res.status} — skipping`);
      return null;
    }
    const svgBuf = Buffer.from(await res.arrayBuffer());
    const png = new Resvg(svgBuf, {
      fitTo: { mode: 'width', value: 320 },
      background: 'rgba(0,0,0,0)',
    }).render().asPng();
    writeFileSync(cachePath, png);
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  } catch (err) {
    console.warn(`[og] logo fetch ${slug} failed: ${err.message} — skipping`);
    return null;
  }
}

// ── Satori font registration ────────────────────────────────────────────
const fonts = [
  { name: 'Geist',      data: readFileSync(FONT_PATHS.sansRegular),  weight: 400, style: 'normal' },
  { name: 'Geist',      data: readFileSync(FONT_PATHS.sansMedium),   weight: 500, style: 'normal' },
  { name: 'Geist',      data: readFileSync(FONT_PATHS.sansSemibold), weight: 600, style: 'normal' },
  { name: 'Geist',      data: readFileSync(FONT_PATHS.sansBold),     weight: 700, style: 'normal' },
  { name: 'Geist Mono', data: readFileSync(FONT_PATHS.monoRegular),  weight: 400, style: 'normal' },
  { name: 'Geist Mono', data: readFileSync(FONT_PATHS.monoMedium),   weight: 500, style: 'normal' },
  { name: 'Geist Mono', data: readFileSync(FONT_PATHS.monoBold),     weight: 700, style: 'normal' },
];

// ── React.createElement-style helper (no JSX needed) ────────────────────
function h(type, props = {}, ...children) {
  return { type, props: { ...props, children: children.flat().filter(Boolean) } };
}

// ═══════════════════════════════════════════════════════════════════════
// VISUAL ASSETS — SVG strings rasterized → PNG data URL via Resvg
// ═══════════════════════════════════════════════════════════════════════

// ── Blueprint grid overlay (48px lines @ 2.5% opacity) ──────────────────
const GRID_BACKDROP = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
    <defs>
      <pattern id="grid" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ffffff" stroke-opacity="0.028" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="1200" height="630" fill="url(#grid)"/>
  </svg>`;
  return svgToDataUrl(svg, 1200);
})();

// ── Gradient mesh helper — returns CSS background string (satori native) ──
// Stacks 4 radial gradients to create depth without rasterization
function makeMeshBg(accentHex, secondaryHex = BRAND.primary) {
  return [
    `radial-gradient(circle at 88% 12%, ${accentHex}55 0%, transparent 55%)`,
    `radial-gradient(circle at 8% 92%, ${accentHex}28 0%, transparent 60%)`,
    `radial-gradient(circle at 45% 110%, ${secondaryHex}1c 0%, transparent 65%)`,
    `radial-gradient(circle at 50% 0%, ${secondaryHex}14 0%, transparent 50%)`,
    BRAND.bg,
  ].join(', ');
}
const MESH_PRIMARY = makeMeshBg(BRAND.primary, BRAND.primary);
const MESH_ACCENT  = makeMeshBg(BRAND.accent,  BRAND.primary);
const MESH_SUCCESS = makeMeshBg(BRAND.success, BRAND.primary);

// ── Sparkline (DolarMap) — abstract USD/BRL ticker ──────────────────────
const SPARKLINE_SVG = (() => {
  // 12 ascending points with realistic noise, viewBox 440×160
  const pts = [
    [10, 132], [50, 118], [90, 124], [130, 105],
    [170, 110], [210, 92], [250, 96], [290, 78],
    [330, 68], [370, 72], [410, 48], [430, 32],
  ];
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ');
  const area = `${line} L 430,160 L 10,160 Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 160" width="440" height="160">
    <defs>
      <linearGradient id="sparkLine" x1="0" y1="0" x2="440" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0%"   stop-color="${BRAND.primary}" stop-opacity="0.55"/>
        <stop offset="55%"  stop-color="${BRAND.primary}"/>
        <stop offset="100%" stop-color="${BRAND.success}"/>
      </linearGradient>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="160" gradientUnits="userSpaceOnUse">
        <stop offset="0%"   stop-color="${BRAND.primary}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${BRAND.primary}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="0" y1="120" x2="440" y2="120" stroke="${BRAND.textFaint}" stroke-opacity="0.45" stroke-dasharray="3,6" stroke-width="1"/>
    <line x1="0" y1="40"  x2="440" y2="40"  stroke="${BRAND.textFaint}" stroke-opacity="0.18" stroke-dasharray="2,8" stroke-width="1"/>
    <path d="${area}" fill="url(#sparkFill)"/>
    <path d="${line}" stroke="url(#sparkLine)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="430" cy="32" r="14" fill="${BRAND.success}" fill-opacity="0.18"/>
    <circle cx="430" cy="32" r="6" fill="${BRAND.success}"/>
  </svg>`;
  return svgToDataUrl(svg, 880);
})();

// ── Bar trio (Stablecoins) — USDT / USDC / Other market share ───────────
const BAR_TRIO_SVG = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280" width="440" height="280">
    <defs>
      <linearGradient id="barGrad" x1="0" y1="240" x2="0" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0%"   stop-color="${BRAND.success}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${BRAND.success}" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    <line x1="0" y1="232" x2="440" y2="232" stroke="${BRAND.textFaint}" stroke-opacity="0.4" stroke-width="1"/>
    <line x1="0" y1="150" x2="440" y2="150" stroke="${BRAND.textFaint}" stroke-opacity="0.15" stroke-dasharray="2,6" stroke-width="1"/>
    <line x1="0" y1="70"  x2="440" y2="70"  stroke="${BRAND.textFaint}" stroke-opacity="0.15" stroke-dasharray="2,6" stroke-width="1"/>
    <rect x="30"  y="40"  width="100" height="192" rx="6" fill="url(#barGrad)"/>
    <rect x="170" y="86"  width="100" height="146" rx="6" fill="url(#barGrad)" fill-opacity="0.85"/>
    <rect x="310" y="160" width="100" height="72"  rx="6" fill="url(#barGrad)" fill-opacity="0.55"/>
  </svg>`;
  return svgToDataUrl(svg, 880);
})();

// ── Exchanges list fragment (Exchanges hub) — mini table preview ────────
const EXCHANGES_LIST_SVG = (() => {
  // 6 rows simulating the exchanges directory table
  const rows = [
    { color: BRAND.success, nameWidth: 144, fee: '0.10%' }, // domestic
    { color: BRAND.accent,  nameWidth: 102, fee: '0.50%' }, // offshore
    { color: BRAND.success, nameWidth: 168, fee: '0.30%' },
    { color: BRAND.accent,  nameWidth: 88,  fee: '0.10%' },
    { color: BRAND.success, nameWidth: 124, fee: '0.40%' },
    { color: BRAND.accent,  nameWidth: 116, fee: '0.25%' },
  ];
  const rowH = 42;
  const headerY = 22;
  const startY = 50;

  const headerSvg = `
    <text x="44" y="${headerY}" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.textFaint}" letter-spacing="2">EXCHANGE</text>
    <text x="430" y="${headerY}" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.textFaint}" letter-spacing="2" text-anchor="end">MAKER FEE</text>
    <line x1="0" y1="32" x2="440" y2="32" stroke="${BRAND.border.replace('0.20', '0.35')}" stroke-width="1"/>
  `;

  const rowsSvg = rows.map((row, i) => {
    const y = startY + i * rowH;
    const textOpacity = (0.78 - i * 0.04).toFixed(2);
    return `
      <circle cx="20" cy="${y + 8}" r="5" fill="${row.color}"/>
      <rect x="40" y="${y + 1}" width="${row.nameWidth}" height="14" rx="3" fill="${BRAND.text}" fill-opacity="${textOpacity}"/>
      <text x="430" y="${y + 13}" font-family="Geist Mono" font-size="15" font-weight="500" fill="${BRAND.text}" fill-opacity="${textOpacity}" text-anchor="end">${row.fee}</text>
      ${i < rows.length - 1 ? `<line x1="0" y1="${y + 30}" x2="440" y2="${y + 30}" stroke="${BRAND.border}" stroke-width="1"/>` : ''}
    `;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 320" width="440" height="320">
    ${headerSvg}
    ${rowsSvg}
  </svg>`;
  return svgToDataUrl(svg, 880);
})();

// ── Code block (Exchanges API) — abstract JSON response ─────────────────
const CODE_BLOCK_SVG = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280" width="440" height="280">
    <rect x="1" y="1" width="438" height="278" rx="14" fill="${BRAND.surface}" stroke="${BRAND.primary}" stroke-opacity="0.32" stroke-width="1"/>
    <!-- header bar -->
    <rect x="1" y="1" width="438" height="42" rx="14" fill="${BRAND.bg}" fill-opacity="0.4"/>
    <circle cx="24" cy="22" r="5" fill="${BRAND.text}" fill-opacity="0.16"/>
    <circle cx="42" cy="22" r="5" fill="${BRAND.text}" fill-opacity="0.16"/>
    <circle cx="60" cy="22" r="5" fill="${BRAND.text}" fill-opacity="0.16"/>
    <text x="220" y="27" font-family="Geist Mono" font-size="12" font-weight="500" fill="${BRAND.textFaint}" text-anchor="middle" letter-spacing="2">GET /v1/exchanges</text>
    <line x1="0" y1="43" x2="440" y2="43" stroke="${BRAND.primary}" stroke-opacity="0.18"/>

    <!-- line numbers -->
    <text x="22" y="78"  font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">1</text>
    <text x="22" y="102" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">2</text>
    <text x="22" y="126" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">3</text>
    <text x="22" y="150" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">4</text>
    <text x="22" y="174" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">5</text>
    <text x="22" y="198" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">6</text>
    <text x="22" y="222" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">7</text>
    <text x="22" y="246" font-family="Geist Mono" font-size="12" fill="${BRAND.textFaint}" fill-opacity="0.55" text-anchor="end">8</text>

    <!-- "code" — abstract rect blocks suggesting syntax highlighting -->
    <!-- {  -->
    <rect x="36" y="69"  width="10"  height="12" rx="2" fill="${BRAND.textMuted}"/>

    <!-- "slug": "binance",  -->
    <rect x="58" y="93"  width="56"  height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="118" y="93" width="6"   height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="132" y="93" width="74"  height="12" rx="2" fill="${BRAND.accent}" fill-opacity="0.9"/>
    <rect x="210" y="93" width="4"   height="12" rx="2" fill="${BRAND.textMuted}"/>

    <!-- "fees": { 0.001, 0.001 } -->
    <rect x="58" y="117" width="44"  height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="106" y="117" width="6"  height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="120" y="117" width="46" height="12" rx="2" fill="${BRAND.primary}" fill-opacity="0.95"/>
    <rect x="170" y="117" width="40" height="12" rx="2" fill="${BRAND.primary}" fill-opacity="0.95"/>

    <!-- "regime": "domestic", -->
    <rect x="58" y="141" width="64"  height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="126" y="141" width="6"  height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="140" y="141" width="78" height="12" rx="2" fill="${BRAND.accent}" fill-opacity="0.9"/>

    <!-- "bcb_authorized": true, -->
    <rect x="58" y="165" width="108" height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="170" y="165" width="6"  height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="184" y="165" width="36" height="12" rx="2" fill="${BRAND.primary}" fill-opacity="0.95"/>

    <!-- "accepts_pix": true -->
    <rect x="58" y="189" width="90"  height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="152" y="189" width="6"  height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="166" y="189" width="36" height="12" rx="2" fill="${BRAND.primary}" fill-opacity="0.95"/>

    <!-- "updated": "2026-05-26" -->
    <rect x="58" y="213" width="60"  height="12" rx="2" fill="${BRAND.success}" fill-opacity="0.95"/>
    <rect x="122" y="213" width="6"  height="12" rx="2" fill="${BRAND.textMuted}"/>
    <rect x="136" y="213" width="92" height="12" rx="2" fill="${BRAND.accent}" fill-opacity="0.9"/>

    <!-- } -->
    <rect x="36" y="237" width="10"  height="12" rx="2" fill="${BRAND.textMuted}"/>

    <!-- cursor -->
    <rect x="50" y="261" width="8" height="12" fill="${BRAND.primary}" fill-opacity="0.7"/>
  </svg>`;
  return svgToDataUrl(svg, 880);
})();

// ── Calendar mark (DeCripto) — bracket-framed deadline glyph ────────────
const CALENDAR_MARK_SVG = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">
    <!-- corner brackets (heavy) -->
    <path d="M 24 72 L 24 24 L 72 24" stroke="${BRAND.accent}" stroke-width="3" fill="none" stroke-linecap="square"/>
    <path d="M 248 24 L 296 24 L 296 72" stroke="${BRAND.accent}" stroke-width="3" fill="none" stroke-linecap="square"/>
    <path d="M 296 248 L 296 296 L 248 296" stroke="${BRAND.accent}" stroke-width="3" fill="none" stroke-linecap="square"/>
    <path d="M 72 296 L 24 296 L 24 248" stroke="${BRAND.accent}" stroke-width="3" fill="none" stroke-linecap="square"/>

    <!-- inner frame -->
    <rect x="46" y="46" width="228" height="228" rx="4" fill="${BRAND.accent}" fill-opacity="0.04" stroke="${BRAND.accent}" stroke-opacity="0.18" stroke-width="1"/>

    <!-- deadline label -->
    <text x="160" y="92" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.accent}" fill-opacity="0.7" text-anchor="middle" letter-spacing="3">DEADLINE</text>
    <line x1="120" y1="106" x2="200" y2="106" stroke="${BRAND.accent}" stroke-opacity="0.35" stroke-width="1"/>

    <!-- main month -->
    <text x="160" y="184" font-family="Geist Mono" font-size="64" font-weight="700" fill="${BRAND.accent}" text-anchor="middle" letter-spacing="-2">JUL</text>

    <!-- year -->
    <text x="160" y="224" font-family="Geist Mono" font-size="26" font-weight="500" fill="${BRAND.accent}" fill-opacity="0.6" text-anchor="middle" letter-spacing="4">2026</text>

    <!-- bottom label -->
    <line x1="100" y1="248" x2="220" y2="248" stroke="${BRAND.accent}" stroke-opacity="0.35" stroke-width="1"/>
    <text x="160" y="268" font-family="Geist Mono" font-size="10" font-weight="500" fill="${BRAND.accent}" fill-opacity="0.55" text-anchor="middle" letter-spacing="2.5">IN 2.291/2025</text>
  </svg>`;
  return svgToDataUrl(svg, 640);
})();

// ── Product stack (Default OG) — 3 abstract product cards ───────────────
const PRODUCT_STACK_SVG = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 380" width="440" height="380">
    <!-- Card 3 (back): Stablecoins (green) -->
    <g transform="translate(56, 8)">
      <rect x="0" y="0" width="360" height="100" rx="14" fill="${BRAND.surface}" stroke="${BRAND.success}" stroke-opacity="0.35"/>
      <rect x="20" y="20" width="48" height="6" rx="2" fill="${BRAND.success}"/>
      <text x="20" y="58" font-family="Geist" font-size="16" font-weight="700" fill="${BRAND.text}">Stablecoins</text>
      <text x="20" y="80" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.textFaint}" letter-spacing="1.5">USDT · USDC · BRZ</text>
      <rect x="260" y="32" width="14" height="56" rx="2" fill="${BRAND.success}" fill-opacity="0.9"/>
      <rect x="280" y="44" width="14" height="44" rx="2" fill="${BRAND.success}" fill-opacity="0.7"/>
      <rect x="300" y="56" width="14" height="32" rx="2" fill="${BRAND.success}" fill-opacity="0.5"/>
      <rect x="320" y="68" width="14" height="20" rx="2" fill="${BRAND.success}" fill-opacity="0.35"/>
    </g>

    <!-- Card 2 (middle): Exchanges API (teal) -->
    <g transform="translate(36, 132)">
      <rect x="0" y="0" width="360" height="100" rx="14" fill="${BRAND.surface}" stroke="${BRAND.primary}" stroke-opacity="0.45"/>
      <rect x="20" y="20" width="48" height="6" rx="2" fill="${BRAND.primary}"/>
      <text x="20" y="58" font-family="Geist" font-size="16" font-weight="700" fill="${BRAND.text}">Exchanges API</text>
      <text x="20" y="80" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.textFaint}" letter-spacing="1.5">GET /v1/exchanges</text>
      <rect x="250" y="36" width="36" height="6" rx="2" fill="${BRAND.primary}"/>
      <rect x="292" y="36" width="50" height="6" rx="2" fill="${BRAND.accent}"/>
      <rect x="250" y="50" width="58" height="6" rx="2" fill="${BRAND.success}"/>
      <rect x="314" y="50" width="28" height="6" rx="2" fill="${BRAND.text}" fill-opacity="0.4"/>
      <rect x="250" y="64" width="44" height="6" rx="2" fill="${BRAND.primary}"/>
    </g>

    <!-- Card 1 (front): DolarMap (teal→green) -->
    <g transform="translate(16, 256)">
      <rect x="0" y="0" width="360" height="100" rx="14" fill="${BRAND.surface}" stroke="${BRAND.primary}" stroke-opacity="0.55"/>
      <rect x="20" y="20" width="48" height="6" rx="2" fill="${BRAND.primary}"/>
      <text x="20" y="58" font-family="Geist" font-size="16" font-weight="700" fill="${BRAND.text}">DolarMap</text>
      <text x="20" y="80" font-family="Geist Mono" font-size="11" font-weight="500" fill="${BRAND.textFaint}" letter-spacing="1.5">USD/BRL · LIVE</text>
      <!-- mini sparkline -->
      <path d="M 240,76 L 256,72 L 270,74 L 284,64 L 298,60 L 312,50 L 326,44 L 342,32"
            stroke="${BRAND.primary}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="342" cy="32" r="3.5" fill="${BRAND.success}"/>
      <circle cx="342" cy="32" r="7" fill="${BRAND.success}" fill-opacity="0.25"/>
    </g>
  </svg>`;
  return svgToDataUrl(svg, 880);
})();

// ── DolarMap wordmark SVG (gradient flattened) ──────────────────────────
const DOLARMAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 179">
  <defs>
    <linearGradient id="dm-og-gradient" x1="0" y1="0" x2="10000" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%"    stop-color="#d8d9db" />
      <stop offset="56.6%" stop-color="#d8d9db" />
      <stop offset="58.5%" stop-color="#2a6c8c" />
      <stop offset="85%"   stop-color="#20a48f" />
    </linearGradient>
  </defs>
  <g transform="translate(0,179) scale(0.1,-0.1)" fill="url(#dm-og-gradient)" stroke="none">
    <path d="M3142 908 l3 -883 179 -3 c137 -2 181 1 188 10 4 7 8 406 8 886 l0 872 -190 0 -190 0 2 -882z"/>
    <path d="M8004 1772 c-52 -5 -107 -62 -152 -154 -67 -140 -83 -183 -241 -651 -158 -465 -261 -727 -286 -727 -16 0 -38 55 -64 157 -24 95 -52 274 -91 583 -25 188 -58 389 -82 495 -44 192 -124 274 -217 219 -59 -35 -87 -106 -176 -444 -84 -318 -175 -580 -203 -580 -16 1 -70 154 -122 345 -70 262 -95 319 -164 373 -59 46 -148 17 -193 -63 -31 -55 -95 -287 -133 -480 -14 -70 -61 -272 -127 -538 -51 -207 -50 -222 9 -253 41 -21 74 -17 108 14 26 24 35 49 76 212 25 102 49 203 54 225 4 22 29 135 55 250 26 116 54 239 61 274 22 99 27 97 55 -16 36 -145 101 -338 137 -407 62 -119 132 -168 217 -152 49 10 124 80 162 154 52 99 131 352 214 692 14 57 23 41 38 -70 7 -47 16 -112 21 -145 13 -87 18 -123 41 -294 23 -179 62 -396 89 -496 41 -157 90 -239 163 -273 55 -26 73 -27 121 -7 119 50 199 216 421 875 134 396 224 640 236 640 13 0 110 -229 149 -351 28 -85 58 -146 76 -153 62 -24 154 31 154 91 0 10 -27 90 -59 178 -152 412 -209 491 -347 477z"/>
    <path d="M0 860 l0 -840 408 0 c455 0 548 8 707 61 250 84 446 271 515 494 7 22 15 47 18 55 2 8 11 -21 18 -65 28 -160 85 -268 196 -370 133 -123 261 -175 477 -192 113 -10 263 24 392 88 160 80 294 253 329 425 17 87 9 293 -15 364 -78 227 -267 389 -513 439 -88 18 -276 13 -364 -9 -205 -51 -380 -194 -453 -370 -10 -25 -25 -52 -32 -60 -11 -12 -13 -5 -13 45 -1 214 -121 451 -295 583 -80 60 -181 112 -275 142 -133 42 -212 48 -667 50 l-433 1 0 -841z m920 495 c255 -80 391 -305 350 -581 -30 -199 -144 -331 -350 -405 -23 -8 -120 -14 -287 -17 l-253 -4 0 517 0 518 243 -6 c189 -4 254 -9 297 -22z m1583 -359 c81 -35 151 -122 177 -218 18 -69 9 -211 -17 -270 -28 -62 -91 -128 -150 -158 -64 -33 -180 -39 -254 -15 -60 20 -138 87 -174 150 -75 131 -51 335 54 442 37 39 107 78 151 87 47 9 175 -2 213 -18z"/>
    <path d="M9228 1604 c-99 -18 -182 -51 -249 -101 -69 -51 -108 -95 -197 -220 -194 -274 -317 -353 -694 -447 -73 -19 -154 -44 -180 -55 -118 -56 -193 -193 -140 -257 55 -68 149 -54 182 27 10 24 27 38 67 55 29 13 61 24 70 24 9 0 30 4 47 10 17 5 82 23 144 40 286 78 446 194 658 475 161 215 209 245 408 253 133 5 203 -6 281 -45 62 -31 90 -56 123 -113 24 -39 27 -56 27 -130 -1 -94 -14 -130 -69 -188 -67 -72 -109 -83 -346 -92 -164 -6 -204 -10 -251 -29 -79 -30 -130 -78 -165 -153 -27 -59 -29 -72 -34 -233 -7 -229 -24 -256 -104 -172 -47 49 -94 133 -142 254 -53 135 -100 168 -183 127 -66 -33 -63 -66 17 -244 75 -168 152 -283 219 -329 55 -37 115 -61 157 -61 38 0 117 38 154 73 58 56 74 120 82 312 4 102 11 179 18 192 24 43 61 53 199 53 252 0 404 44 516 148 100 93 137 187 137 342 0 158 -38 251 -143 346 -138 127 -375 181 -609 138z"/>
    <path d="M3986 1315 c-130 -27 -248 -72 -313 -121 l-31 -24 41 -77 c23 -43 53 -100 66 -126 23 -45 43 -58 56 -37 6 10 63 38 122 61 136 53 309 53 407 -1 42 -23 83 -78 97 -131 22 -81 27 -79 -208 -79 -317 0 -440 -32 -538 -142 -61 -67 -85 -134 -85 -238 0 -49 5 -102 11 -117 33 -81 46 -101 90 -145 107 -107 308 -156 504 -124 70 12 170 61 215 106 21 21 41 36 44 33 3 -4 6 -32 6 -64 0 -73 -5 -71 195 -67 l150 3 3 405 c3 408 0 463 -35 570 -22 69 -56 120 -119 181 -64 60 -135 99 -229 125 -82 23 -354 28 -449 9z m452 -810 c4 -80 -2 -99 -49 -150 -66 -72 -159 -104 -264 -90 -89 11 -165 80 -165 150 0 41 35 93 80 119 30 18 58 22 205 27 94 3 175 5 180 4 6 -1 11 -28 13 -60z"/>
    <path d="M5585 1311 c-81 -24 -151 -61 -207 -110 l-47 -42 -3 78 -3 78 -164 3 c-112 2 -168 -1 -177 -9 -12 -10 -14 -118 -14 -645 l0 -633 33 -6 c17 -3 102 -5 187 -3 l155 3 5 360 c3 198 9 369 14 380 26 63 54 112 79 137 57 57 147 88 255 88 l72 0 0 170 0 170 -62 -1 c-35 0 -90 -8 -123 -18z"/>
  </g>
</svg>`;
const DOLARMAP_LOGO_URL_LG = svgToDataUrl(DOLARMAP_SVG, 640);
const DOLARMAP_LOGO_URL_MD = svgToDataUrl(DOLARMAP_SVG, 480);

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTS — satori-flexbox primitives via h()
// ═══════════════════════════════════════════════════════════════════════

// ── OG shell — outer 1200×630 container with mesh bg + grid overlay ─────
function OGShell({ mesh, children }) {
  return h('div', {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      position: 'relative', color: BRAND.text, fontFamily: 'Geist',
      background: mesh,
    },
  },
    // Grid overlay
    h('img', {
      src: GRID_BACKDROP, width: 1200, height: 630,
      style: { position: 'absolute', top: 0, left: 0 },
    }),
    // Content
    h('div', {
      style: {
        display: 'flex', flexDirection: 'column',
        position: 'relative', flexGrow: 1,
        padding: '44px 64px 36px 64px',
        width: '100%',
        boxSizing: 'border-box',
      },
    }, ...(Array.isArray(children) ? children : [children])),
  );
}

// ── bitsARK Labs wordmark ───────────────────────────────────────────────
function Wordmark({ size = 'md' } = {}) {
  const sizes = {
    sm: { main: 28, labs: 18, gap: 6 },
    md: { main: 38, labs: 24, gap: 8 },
    lg: { main: 56, labs: 32, gap: 12 },
    xl: { main: 78, labs: 44, gap: 14 },
  };
  const s = sizes[size];
  return h('div', { style: { display: 'flex', alignItems: 'baseline' } },
    h('span', { style: { color: BRAND.text,      fontSize: s.main, fontWeight: 700, letterSpacing: '-0.02em' } }, 'bits'),
    h('span', { style: { color: BRAND.primary,   fontSize: s.main, fontWeight: 700, letterSpacing: '-0.02em' } }, 'ARK'),
    h('span', { style: { color: BRAND.textMuted, fontSize: s.labs, fontWeight: 500, marginLeft: s.gap, letterSpacing: '-0.005em' } }, 'Labs'),
  );
}

// ── Faint endorser wordmark (for "by bitsARK Labs") ─────────────────────
function EndorserWordmark({ size = 24 } = {}) {
  return h('div', { style: { display: 'flex', alignItems: 'baseline' } },
    h('span', { style: { color: BRAND.textFaint, fontSize: size, fontWeight: 700, letterSpacing: '-0.02em' } }, 'bits'),
    h('span', { style: { color: BRAND.textFaint, fontSize: size, fontWeight: 700, letterSpacing: '-0.02em' } }, 'ARK'),
    h('span', { style: { color: BRAND.textFaint, fontSize: Math.round(size * 0.7), fontWeight: 500, marginLeft: 7, opacity: 0.85 } }, 'Labs'),
  );
}

// ── Editorial "— by —" separator ────────────────────────────────────────
function BySeparator({ color = BRAND.textFaint } = {}) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: 'Geist Mono', fontSize: 13, fontWeight: 500,
      color, textTransform: 'uppercase', letterSpacing: '0.18em',
    },
  },
    h('span', { style: { display: 'flex', width: 16, height: 1, background: color, opacity: 0.5 } }),
    h('span', { style: { display: 'flex', opacity: 0.75 } }, 'by'),
    h('span', { style: { display: 'flex', width: 16, height: 1, background: color, opacity: 0.5 } }),
  );
}

// ── Product identity composite ──────────────────────────────────────────
function ProductIdentity({ product, productSub, productColor = BRAND.primary, scale = 'md' }) {
  const isLg = scale === 'lg';
  let productBlock;

  if (product === 'DolarMap') {
    productBlock = h('img', {
      src: isLg ? DOLARMAP_LOGO_URL_LG : DOLARMAP_LOGO_URL_MD,
      width: isLg ? 320 : 240,
      height: isLg ? 57 : 43,
      style: { display: 'flex' },
    });
  } else {
    const nameSize = isLg ? 50 : 40;
    const subSize  = isLg ? 22 : 18;
    productBlock = h('div', {
      style: { display: 'flex', flexDirection: 'column', lineHeight: 1 },
    },
      h('span', {
        style: {
          fontFamily: 'Geist Mono',
          fontSize: nameSize, fontWeight: 700, color: productColor,
          letterSpacing: '-0.04em',
        },
      }, product),
      productSub && h('span', {
        style: {
          fontFamily: 'Geist Mono',
          fontSize: subSize, fontWeight: 500, color: BRAND.textFaint,
          letterSpacing: '0.04em', marginTop: 6,
        },
      }, productSub),
    );
  }

  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: 22 },
  },
    productBlock,
    BySeparator(),
    EndorserWordmark({ size: isLg ? 28 : 22 }),
  );
}

// ── Top metadata bar — accent bracket + uppercase mono segments ─────────
function TopMetaBar({ segments = [], accent = BRAND.primary }) {
  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: 14, position: 'relative' },
  },
    h('div', {
      style: { display: 'flex', width: 4, height: 22, background: accent, borderRadius: 2 },
    }),
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 14,
        fontFamily: 'Geist Mono', fontSize: 14, fontWeight: 500,
        color: BRAND.textMuted, textTransform: 'uppercase', letterSpacing: '0.18em',
      },
    },
      ...segments.flatMap((seg, i) => {
        const items = [h('span', { style: { display: 'flex' } }, seg)];
        if (i < segments.length - 1) {
          items.push(h('span', { style: { display: 'flex', color: BRAND.textFaint, opacity: 0.55 } }, '·'));
        }
        return items;
      }),
    ),
  );
}

// ── Pill chip — mono uppercase ──────────────────────────────────────────
function Chip({ label, color = BRAND.primary, faint = false }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center',
      padding: '7px 14px',
      background: faint ? 'transparent' : `${color}1a`,
      color: faint ? BRAND.textFaint : color,
      border: `1px solid ${faint ? `${BRAND.textFaint}30` : `${color}55`}`,
      borderRadius: 999,
      fontFamily: 'Geist Mono', fontSize: 13, fontWeight: 500,
      letterSpacing: '0.04em',
    },
  }, label);
}

// ── Data table row — flex columns with divider borders ──────────────────
function DataTable({ cols }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'stretch',
      borderTop: `1px solid ${BRAND.borderStrong}`,
      borderBottom: `1px solid ${BRAND.borderStrong}`,
      paddingTop: 16, paddingBottom: 16,
    },
  },
    ...cols.map((col, i) =>
      h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 6,
          paddingLeft: i === 0 ? 0 : 28, paddingRight: 28,
          borderRight: i < cols.length - 1 ? `1px solid ${BRAND.borderStrong}` : 'none',
        },
      },
        h('span', {
          style: {
            display: 'flex',
            fontFamily: 'Geist Mono', fontSize: 12, fontWeight: 500,
            color: BRAND.textFaint, textTransform: 'uppercase', letterSpacing: '0.18em',
          },
        }, col.label),
        h('span', {
          style: {
            display: 'flex',
            fontFamily: 'Geist Mono', fontSize: 28, fontWeight: 500,
            color: col.valueColor || BRAND.text, letterSpacing: '-0.01em',
          },
        }, col.value),
      ),
    ),
  );
}

// ── Footer row — URL left, brand+version right ──────────────────────────
function FooterRow({ url, accent = BRAND.primary, right = 'BITSARK LABS' }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'relative',
      paddingTop: 18,
      borderTop: `1px solid ${BRAND.border}`,
    },
  },
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'Geist Mono', fontSize: 18, fontWeight: 500,
        color: BRAND.textMuted,
      },
    },
      h('span', { style: { display: 'flex', color: accent, fontWeight: 700 } }, '→'),
      h('span', { style: { display: 'flex' } }, url),
    ),
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'Geist Mono', fontSize: 12, fontWeight: 500,
        color: BRAND.textFaint, textTransform: 'uppercase', letterSpacing: '0.2em',
      },
    },
      h('span', { style: { display: 'flex' } }, right),
      h('span', { style: { display: 'flex', width: 4, height: 4, borderRadius: 999, background: accent, opacity: 0.7 } }),
      h('span', { style: { display: 'flex' } }, VERSION_TAG),
    ),
  );
}

// ── Visual legend — mono caption under a data viz ───────────────────────
function VisualLegend({ label, dotColor = BRAND.primary }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'Geist Mono', fontSize: 12, fontWeight: 500,
      color: BRAND.textFaint, textTransform: 'uppercase', letterSpacing: '0.2em',
    },
  },
    h('span', { style: { display: 'flex', width: 6, height: 6, borderRadius: 999, background: dotColor } }),
    h('span', { style: { display: 'flex' } }, label),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════

// ── 1. Default site OG ──────────────────────────────────────────────────
function DefaultTemplate() {
  return OGShell({
    mesh: MESH_PRIMARY,
    children: [
      // Top metabar
      h('div', { style: { display: 'flex' } },
        TopMetaBar({
          segments: ['BITSARK LABS', 'OPEN DATA INFRASTRUCTURE', 'BR'],
          accent: BRAND.primary,
        }),
      ),
      // Hero split
      h('div', {
        style: {
          display: 'flex', flexGrow: 1, alignItems: 'center', gap: 36,
          marginTop: 24,
        },
      },
        // Left
        h('div', {
          style: { display: 'flex', flexDirection: 'column', gap: 28, width: 600 },
        },
          Wordmark({ size: 'xl' }),
          h('div', {
            style: {
              display: 'flex',
              fontSize: 34, fontWeight: 500, lineHeight: 1.2,
              letterSpacing: '-0.015em', color: BRAND.text,
            },
          }, 'Open data infrastructure for the Brazilian crypto market.'),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' } },
            Chip({ label: 'DolarMap',      color: BRAND.primary }),
            Chip({ label: 'Exchanges API', color: BRAND.primary }),
            Chip({ label: 'Stablecoins',   color: BRAND.success }),
            Chip({ label: 'DeCripto',      color: BRAND.accent }),
          ),
        ),
        // Right — product stack
        h('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexGrow: 1 },
        },
          h('img', { src: PRODUCT_STACK_SVG, width: 440, height: 380, style: { display: 'flex' } }),
        ),
      ),
      // Footer
      FooterRow({ url: 'bitsark.com', accent: BRAND.primary, right: 'EST. 2025' }),
    ],
  });
}

// ── 2. Exchange OG ──────────────────────────────────────────────────────
function ExchangeTemplate(ex, logoDataUrl) {
  const isOffshore = ex.fiscal_details_br?.tax_regime === 'offshore_law_14754';
  const isBcbAuthorized = ex.operational_details_br?.bcb_authorized === true;
  const acceptsPix = ex.operational_details_br?.accepts_pix === true;
  const jurisdiction = ex.operational_details_br?.main_jurisdiction_iso || '—';

  const maker = ex.fees?.maker;
  const taker = ex.fees?.taker;
  const formatFee = (v) =>
    v == null ? '—' : v === 0 ? '0.00%' : `${(v * 100).toFixed(2)}%`;

  const regimeColor = isOffshore ? BRAND.accent : BRAND.success;
  const regimeLabel = isOffshore ? 'OFFSHORE · LEI 14.754' : 'DOMESTIC · BR REGIME';
  const mesh = isOffshore ? MESH_ACCENT : MESH_PRIMARY;

  // Logo card OR fallback initial
  const logoCard = h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 220, height: 220, borderRadius: 28,
      background: BRAND.surface,
      border: `1px solid ${regimeColor}50`,
    },
  },
    logoDataUrl
      ? h('img', {
          src: logoDataUrl, width: 156, height: 156,
          style: { display: 'flex', objectFit: 'contain' },
        })
      : h('div', {
          style: {
            display: 'flex',
            color: regimeColor, fontSize: 112, fontWeight: 700,
            fontFamily: 'Geist', letterSpacing: '-0.04em',
            lineHeight: 1,
          },
        }, (ex.name || '?').charAt(0).toUpperCase()),
  );

  // Status chips below logo
  const bcbChip = Chip({
    label: isBcbAuthorized ? 'BCB AUTHORIZED' : 'NO BCB',
    color: isBcbAuthorized ? BRAND.success : BRAND.textFaint,
    faint: !isBcbAuthorized,
  });
  const pixChip = Chip({
    label: acceptsPix ? 'ACCEPTS PIX' : 'NO PIX',
    color: acceptsPix ? BRAND.success : BRAND.textFaint,
    faint: !acceptsPix,
  });

  return OGShell({
    mesh,
    children: [
      // Top metabar
      h('div', { style: { display: 'flex' } },
        TopMetaBar({
          segments: ['EXCHANGES', 'IN BRAZIL', 'BY BITSARK LABS'],
          accent: regimeColor,
        }),
      ),
      // Hero split (55/45)
      h('div', {
        style: { display: 'flex', flexGrow: 1, alignItems: 'center', gap: 40, marginTop: 22 },
      },
        // Left — name + regime + data table
        h('div', {
          style: { display: 'flex', flexDirection: 'column', gap: 20, width: 660 },
        },
          // Exchange name
          h('div', {
            style: {
              display: 'flex',
              fontSize: 88, fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em',
              color: BRAND.text,
            },
          }, ex.name),
          // Regime chip
          h('div', { style: { display: 'flex' } },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 14px',
                background: `${regimeColor}14`,
                color: regimeColor,
                border: `1px solid ${regimeColor}55`,
                borderRadius: 999,
                fontFamily: 'Geist Mono', fontSize: 13, fontWeight: 500,
                letterSpacing: '0.16em',
              },
            },
              h('span', { style: { display: 'flex', width: 6, height: 6, borderRadius: 999, background: regimeColor } }),
              h('span', { style: { display: 'flex' } }, regimeLabel),
            ),
          ),
          // Data table
          DataTable({
            cols: [
              { label: 'MAKER', value: formatFee(maker) },
              { label: 'TAKER', value: formatFee(taker) },
              { label: 'JURIS', value: jurisdiction },
            ],
          }),
        ),
        // Right — logo card + status chips
        h('div', {
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            flexGrow: 1,
          },
        },
          logoCard,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
            bcbChip,
            pixChip,
          ),
        ),
      ),
      // Footer
      FooterRow({
        url: `bitsark.com/exchanges/${ex.slug}`,
        accent: regimeColor,
      }),
    ],
  });
}

// ── 3. Page template — variant-driven right visual ──────────────────────
function PageTemplate({ eyebrow, title, subtitle, url, accent, productIdentity, variant, metabarSegments, mesh, titleSize = 56 }) {
  const visuals = {
    sparkline: h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 } },
      h('img', { src: SPARKLINE_SVG, width: 440, height: 160, style: { display: 'flex' } }),
      VisualLegend({ label: 'USD / BRL · last 24h', dotColor: BRAND.success }),
    ),
    bartrio: h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 } },
      h('img', { src: BAR_TRIO_SVG, width: 440, height: 280, style: { display: 'flex' } }),
      VisualLegend({ label: 'market share · brazil 2026', dotColor: BRAND.success }),
    ),
    dotcloud: h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 } },
      h('img', { src: EXCHANGES_LIST_SVG, width: 440, height: 320, style: { display: 'flex' } }),
      VisualLegend({ label: '24+ exchanges · BR market', dotColor: BRAND.primary }),
    ),
    codeblock: h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 } },
      h('img', { src: CODE_BLOCK_SVG, width: 440, height: 280, style: { display: 'flex' } }),
      VisualLegend({ label: 'REST · JSON · public', dotColor: BRAND.primary }),
    ),
    calendar: h('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' },
    },
      h('img', { src: CALENDAR_MARK_SVG, width: 320, height: 320, style: { display: 'flex' } }),
    ),
  };
  const visual = visuals[variant] || null;
  const leftWidth = variant === 'calendar' ? 620 : 600;

  return OGShell({
    mesh: mesh || MESH_PRIMARY,
    children: [
      // Top metabar
      h('div', { style: { display: 'flex' } },
        TopMetaBar({ segments: metabarSegments, accent }),
      ),
      // Product identity row
      h('div', { style: { display: 'flex', marginTop: 22 } },
        productIdentity
          ? ProductIdentity({ ...productIdentity, scale: 'lg' })
          : Wordmark({ size: 'lg' }),
      ),
      // Hero split
      h('div', {
        style: {
          display: 'flex', flexGrow: 1, alignItems: 'center', gap: 36,
          marginTop: 4,
        },
      },
        // Left
        h('div', {
          style: { display: 'flex', flexDirection: 'column', gap: 18, width: visual ? leftWidth : 1000 },
        },
          eyebrow && h('div', { style: { display: 'flex' } },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 14px',
                borderRadius: 999,
                background: `${accent}14`,
                color: accent,
                border: `1px solid ${accent}55`,
                fontFamily: 'Geist Mono', fontSize: 13, fontWeight: 500,
                letterSpacing: '0.16em',
              },
            },
              h('span', { style: { display: 'flex', width: 6, height: 6, borderRadius: 999, background: accent } }),
              h('span', { style: { display: 'flex' } }, eyebrow),
            ),
          ),
          h('div', {
            style: {
              display: 'flex',
              fontSize: titleSize, fontWeight: 700,
              lineHeight: 1.04, letterSpacing: '-0.028em',
              color: BRAND.text,
            },
          }, title),
          subtitle && h('div', {
            style: {
              display: 'flex',
              fontSize: 22, color: BRAND.textMuted, lineHeight: 1.45,
              letterSpacing: '-0.005em',
            },
          }, subtitle),
        ),
        // Right visual
        visual && h('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexGrow: 1 },
        }, visual),
      ),
      // Footer
      FooterRow({ url, accent }),
    ],
  });
}

// ── Render satori → resvg → PNG ─────────────────────────────────────────
async function renderToPng(node, outPath) {
  const svg = await satori(node, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: RESVG_FONT,
  }).render().asPng();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(`[og] generating images → ${OUT_DIR.replace(ROOT, '.')}/`);

  // 1. Default site OG
  await renderToPng(DefaultTemplate(), join(ROOT, 'public', 'og-default.png'));
  console.log('[og]   ✓ og-default.png');

  // 2. Pre-fetch & cache exchange logos
  console.log('[og] caching exchange logos...');
  const logoMap = new Map();
  for (const ex of exchanges) {
    if (!ex.logo_url) continue;
    const dataUrl = await fetchExchangeLogo(ex.slug, ex.logo_url);
    if (dataUrl) logoMap.set(ex.slug, dataUrl);
  }
  console.log(`[og]   ${logoMap.size}/${exchanges.length} exchange logos ready`);

  // 3. Exchange OGs
  mkdirSync(join(OUT_DIR, 'exchanges'), { recursive: true });
  for (const ex of exchanges) {
    await renderToPng(
      ExchangeTemplate(ex, logoMap.get(ex.slug) ?? null),
      join(OUT_DIR, 'exchanges', `${ex.slug}.png`),
    );
    console.log(`[og]   ✓ exchanges/${ex.slug}.png`);
  }

  // 4. Key marketing pages
  const pages = [
    {
      slug: 'dolarmap',
      productIdentity: { product: 'DolarMap', productColor: BRAND.primary },
      eyebrow: 'LIVE BR FX',
      title: 'Real-time USD/BRL across every Brazilian exchange.',
      subtitle: 'Live rates · Alerts · Arbitrage · Stablecoins comparison.',
      accent: BRAND.primary,
      mesh: MESH_PRIMARY,
      variant: 'sparkline',
      titleSize: 54,
      metabarSegments: ['DOLARMAP', 'LIVE FX', VERSION_TAG.toUpperCase()],
    },
    {
      slug: 'exchanges',
      productIdentity: { product: 'Exchanges', productSub: 'in Brazil', productColor: BRAND.primary },
      eyebrow: 'EXCHANGES DIRECTORY',
      title: 'Every Brazilian crypto exchange — fees, regulation, Pix.',
      subtitle: 'BCB licensing · DeCripto · DARF guidance.',
      accent: BRAND.primary,
      mesh: MESH_PRIMARY,
      variant: 'dotcloud',
      titleSize: 50,
      metabarSegments: ['EXCHANGES', 'IN BRAZIL', 'DIRECTORY'],
    },
    {
      slug: 'stablecoins-brasil',
      productIdentity: { product: 'Stablecoins', productSub: 'in Brazil', productColor: BRAND.success },
      eyebrow: 'STABLECOINS BRASIL',
      title: 'Brazil is the largest stablecoin economy in Latin America.',
      subtitle: 'Live data from CoinGecko · Banco Central do Brasil.',
      accent: BRAND.success,
      mesh: MESH_SUCCESS,
      variant: 'bartrio',
      titleSize: 48,
      metabarSegments: ['STABLECOINS', 'IN BRAZIL', 'MARKET DATA'],
    },
    {
      slug: 'decripto',
      productIdentity: { product: 'Exchanges', productSub: 'in Brazil', productColor: BRAND.primary },
      eyebrow: 'TAX REPORTING DEADLINE',
      title: 'Brazil’s new crypto tax reporting rules take effect July 2026.',
      subtitle: 'Definitive guide for users, investors, and accountants.',
      accent: BRAND.accent,
      mesh: MESH_ACCENT,
      variant: 'calendar',
      titleSize: 50,
      metabarSegments: ['DECRIPTO', 'IN 2.291/2025', 'REGULATORY GUIDE'],
    },
    {
      slug: 'exchanges-api',
      productIdentity: { product: 'Exchanges', productSub: 'in Brazil', productColor: BRAND.primary },
      eyebrow: 'PUBLIC REST API',
      title: 'Free, public REST API for Brazilian exchange data.',
      subtitle: 'Fees · Regulation · CNPJ · Updated weekly.',
      accent: BRAND.primary,
      mesh: MESH_PRIMARY,
      variant: 'codeblock',
      titleSize: 50,
      metabarSegments: ['EXCHANGES API', 'REST', 'FREE', VERSION_TAG.toUpperCase()],
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
