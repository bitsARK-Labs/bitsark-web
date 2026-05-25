#!/usr/bin/env node
/**
 * Guard contra a classe de bug do Organization duplicado em JSON-LD.
 *
 * Regras:
 * 1. No máximo UMA Organization com @id === "https://bitsark.com/#organization"
 *    por HTML (a fonte única em Base.astro).
 * 2. Nenhuma Organization sem @id que represente a bitsARK (detectada por url
 *    igual a https://bitsark.com ou name contendo "bitsARK").
 *
 * Organizations terceiras (Wise Business, Husky, etc.) usadas em `mentions` ou
 * similar são permitidas - têm name/url próprios e não conflitam pelo @id.
 *
 * Roda no postbuild via npm. Falha o build se houver duplicata.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

async function walkHtml(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkHtml(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

const ORG_ID = "https://bitsark.com/#organization";

function looksLikeBitsArk(node) {
  if (typeof node["@id"] === "string" && node["@id"] === ORG_ID) return true;
  if (typeof node.url === "string" && /^https?:\/\/(?:www\.)?bitsark\.com\/?$/.test(node.url)) return true;
  if (typeof node.name === "string" && /bitsark/i.test(node.name)) return true;
  return false;
}

function inspectOrganizations(json) {
  const bitsark = [];
  const stack = Array.isArray(json) ? [...json] : [json];
  while (stack.length) {
    const node = stack.shift();
    if (!node || typeof node !== "object") continue;
    if (node["@type"] === "Organization" && looksLikeBitsArk(node)) {
      bitsark.push(node);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        stack.push(...value.filter(v => v && typeof v === "object"));
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return bitsark;
}

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const files = await walkHtml(DIST);
if (files.length === 0) {
  console.warn("[schema-guard] No HTML files found in dist/. Did the build run?");
  process.exit(0);
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

let violations = 0;
for (const file of files) {
  const rawHtml = await readFile(file, "utf8");
  const html = rawHtml.replace(HTML_COMMENT_RE, "");
  const found = [];
  for (const match of html.matchAll(JSONLD_RE)) {
    const body = match[1].trim();
    if (!body) continue;
    try {
      const json = JSON.parse(body);
      found.push(...inspectOrganizations(json));
    } catch (e) {
      console.warn(`[schema-guard] ${relative(ROOT, file)}: failed to parse a JSON-LD block (${e.message})`);
    }
  }
  if (found.length > 1) {
    const ids = found.map(o => o["@id"] ?? "(no @id)").join(", ");
    console.error(`[schema-guard] ${relative(ROOT, file)}: ${found.length} bitsARK Organization declarations [${ids}] (max 1)`);
    violations++;
  }
}

if (violations) {
  console.error(`\n[schema-guard] FAIL: ${violations} file(s) violate the single-Organization policy.`);
  console.error("[schema-guard] Pages must reference Organization via { \"@id\": \"https://bitsark.com/#organization\" }, never redeclare it.");
  process.exit(1);
}
console.log(`[schema-guard] OK - ${files.length} HTML files checked.`);
