/**
 * Verifica se todos os paths usados em l('...') existem como páginas em src/pages/.
 * Ignora anchors (#section) - valida apenas o path base.
 * Ignora rotas dinâmicas ([slug]) - essas são válidas por definição.
 *
 * Uso: node scripts/check-links.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.cwd();
const PAGES_DIR = join(ROOT, 'src', 'pages');
const SRC_DIR = join(ROOT, 'src');

// --- Coleta páginas existentes ---

function collectPages(dir, base = '') {
  const pages = new Set();
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      for (const p of collectPages(full, `${base}/${entry}`)) pages.add(p);
    } else if (entry.endsWith('.astro') || entry.endsWith('.md') || entry.endsWith('.mdx')) {
      let path = base;
      const name = entry.replace(/\.(astro|mdx?)$/, '');
      if (name !== 'index') path = `${base}/${name}`;
      if (path === '') path = '/';
      pages.add(path || '/');
    }
  }
  return pages;
}

const allPages = collectPages(PAGES_DIR);

// Normaliza: rotas /pt/... são a versão PT das rotas EN base
// Para validar l('/foo'), precisamos checar se '/foo' existe (EN) ou '/pt/foo' existe (PT)
const enPages = new Set([...allPages].filter(p => !p.startsWith('/pt/')));
const ptPages = new Set([...allPages].filter(p => p.startsWith('/pt/')).map(p => p.slice(3) || '/'));

// Rotas dinâmicas (ex: /exchanges/[slug]) - considerar o segmento pai como válido
const dynamicParents = new Set(
  [...allPages]
    .filter(p => p.includes('['))
    .map(p => p.split('/').slice(0, -1).join('/') || '/')
);

function isValidPath(path) {
  // Remove anchor
  const base = path.split('#')[0] || '/';
  // Verifica existência direta
  if (enPages.has(base)) return true;
  // Verifica se o path é filho de uma rota dinâmica
  const parent = base.split('/').slice(0, -1).join('/') || '/';
  if (dynamicParents.has(parent) || dynamicParents.has(`/pt${parent}`)) return true;
  return false;
}

// --- Extrai usos de l() nos arquivos fonte ---

function collectFiles(dir, exts) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectFiles(full, exts));
    } else if (exts.some(ext => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

const sourceFiles = collectFiles(SRC_DIR, ['.astro', '.ts', '.tsx', '.js', '.mjs']);

// Regex: l('/...') ou l("/...")
const L_PATTERN = /\bl\(['"](\/?[^'"]*)['"]\)/g;

const broken = [];
const seen = new Map(); // path -> first occurrence

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf-8');
  let match;
  while ((match = L_PATTERN.exec(content)) !== null) {
    const path = match[1].startsWith('/') ? match[1] : `/${match[1]}`;
    const base = path.split('#')[0];
    if (!seen.has(base)) seen.set(base, []);
    const lineNum = content.slice(0, match.index).split('\n').length;
    seen.get(base).push({ file: relative(ROOT, file), line: lineNum });
    if (!isValidPath(path)) {
      broken.push({ path, file: relative(ROOT, file), line: lineNum });
    }
  }
}

// --- Relatório ---

console.log('\n=== check-links: l() path validation ===\n');
console.log(`Pages found:  ${allPages.size} (EN: ${enPages.size}, PT: ${ptPages.size})`);
console.log(`Unique paths used in l(): ${seen.size}`);
console.log(`Dynamic route parents: ${[...dynamicParents].join(', ') || 'none'}\n`);

if (broken.length === 0) {
  console.log('✓ All l() paths resolve to existing pages.\n');
  process.exit(0);
} else {
  console.error(`✗ ${broken.length} broken path(s) found:\n`);
  for (const { path, file, line } of broken) {
    console.error(`  ${path}`);
    console.error(`    → ${file}:${line}`);
  }
  console.error('');
  process.exit(1);
}
