#!/usr/bin/env node
// submit-indexnow.mjs - key check, gz support, retries, exponential backoff

import zlib from 'zlib';

const KEY = process.env.INDEXNOW_KEY || 'a9c4f8b71eb84f839567f9bc6c6c9e90';
const HOST = 'bitsark.com';
const SITE = 'https://bitsark.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10_000;
const TIMEOUT = 15000;
const MAX_RETRIES = 5;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), TIMEOUT);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(id);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || '';
  const isGz = url.endsWith('.gz') || contentType.includes('gzip');
  if (isGz) {
    const decompressed = zlib.gunzipSync(Buffer.from(buf));
    return decompressed.toString('utf8');
  }
  return Buffer.from(buf).toString('utf8');
}

async function checkKeyLive(){
  const url = `${SITE}/${KEY}.txt`;
  try {
    const txt = await fetchText(url);
    if (txt.trim() !== KEY) throw new Error('Key content mismatch');
    console.log('[indexnow] key file OK');
  } catch (err){
    console.error('[indexnow] key file check failed:', err.message);
    throw err;
  }
}

function extractLocs(xml){
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

async function fetchSitemapUrls(){
  // try sitemap-index.xml then sitemap.xml
  const candidates = [`${SITE}/sitemap-index.xml`, `${SITE}/sitemap.xml`];
  for (const c of candidates){
    try {
      const txt = await fetchText(c);
      // if index file contains child sitemaps
      if (c.includes('index') || txt.includes('<sitemapindex')) {
        const child = extractLocs(txt);
        const all = [];
        for (const childUrl of child){
          const xml = await fetchText(childUrl);
          all.push(...extractLocs(xml));
        }
        return all;
      } else {
        return extractLocs(txt);
      }
    } catch (e){
      // try next candidate
    }
  }
  throw new Error('No sitemap found');
}

async function submitBatch(urls){
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList: urls
  });
  for (let attempt=0; attempt<MAX_RETRIES; attempt++){
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      if (res.status === 200 || res.status === 202) return res.status;
      if (res.status >= 500 || res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[indexnow] transient ${res.status}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      // client error: break
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    } catch (err){
      if (attempt === MAX_RETRIES - 1) throw err;
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(`[indexnow] request failed (${err.message}), retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

(async ()=>{
  try {
    await checkKeyLive();
    const urls = await fetchSitemapUrls();
    console.log(`[indexnow] ${urls.length} URLs found`);
    for (let i=0;i<urls.length;i+=BATCH){
      const batch = urls.slice(i, i+BATCH);
      const status = await submitBatch(batch);
      console.log(`[indexnow] submitted ${batch.length} URLs → HTTP ${status}`);
    }
    console.log('[indexnow] done');
    process.exit(0);
  } catch (err){
    console.error('[indexnow] fatal:', err.message);
    process.exit(2);
  }
})();
