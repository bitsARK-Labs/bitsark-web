# SEO Rules

> Last updated: 2026-05-29

Hard rules for creating or editing pages on `bitsark.com` so we don't regress the
SEO fixes already in place. If you want the *why* behind the build setup, see
[architecture.md](./architecture.md).

These rules exist because SiteChecker.pro crawls flagged recurring mistakes.
All are now fixed site-wide and guarded by the conventions below - keep them that way.

---

## 1. Trailing slashes - every internal link MUST end with `/`

**The rule:** every internal link points to the trailing-slash URL.
`/exchanges/`, never `/exchanges`. `/exchanges/decripto/`, never `/exchanges/decripto`.

**Why it matters:** the build emits *directory format* (`/exchanges/index.html`), so the
canonical URL of every page is the trailing-slash form. `astro.config.mjs` sets
`trailingSlash: 'always'`, and `<link rel="canonical">` + the sitemap all use the slash.
A link without the slash makes Cloudflare Pages serve a **308 redirect** to the slash
version. SiteChecker reports this as *"Internal redirects from trailing slash mismatch"*
and it wastes crawl budget and dilutes link equity.

**How to stay correct:**

- **Prefer the `l()` helper.** It normalizes the trailing slash (and PT prefix) for you:
  - In pages: `import { useLocalizedPath } from '@i18n/index'` → `const l = useLocalizedPath(lang)` → `href={l('/exchanges')}` emits `/exchanges/`.
  - `Base.astro` and `MobileMenu.astro` have their own inline `l()` (they also translate EN→PT paths); both normalize slashes too.
  - `l()` preserves `#fragments` and `?queries` and puts the slash *before* them: `l('/dolarmap#sell')` → `/dolarmap/#sell`.
- **Raw `href="/..."` in markup** (not going through `l()`): write the slash yourself - `href="/about/"`.
- **Dynamic slugs:** `` href={`/exchanges/${slug}/`} `` - include the trailing slash in the template.
- **Links inside i18n strings** (`en.json` / `pt.json`, rendered via `set:html`): write the slash in the JSON string - `href=\"/terms/\"`. The `l()` helper cannot reach inside translation strings, so these are easy to miss.
- **Structured i18n values** (e.g. a `"href": "/exchanges/decripto"` data field): include the slash there too.

**Exceptions (no trailing slash):** external links (`https://…`), `mailto:`, pure anchors
(`#section`), and static assets (`.png`, `.svg`, `.json`, `.xml`, `.ico`, `/favicon.ico`,
`/site.webmanifest`, fonts, etc.).

**Verify before commit:**

```bash
npm run build
# Sweep dist for any internal link missing a trailing slash (should print nothing):
grep -rhoE 'href="/[a-zA-Z][^"#?]*"' dist --include=*.html \
  | sed -E 's/.*href="([^"]*)".*/\1/' \
  | grep -vE '/$' \
  | grep -vE '\.(png|svg|jpg|jpeg|webp|json|xml|ico|webmanifest|woff2|txt|pdf|css|js)$' \
  | sort -u
```

---

## 2. `noindex` and `hreflang` are mutually exclusive

**The rule:** a page that is `noindex` MUST NOT emit `hreflang` annotations, and no other
page may point an `hreflang` at it.

**Why it matters:** `hreflang` tells Google *"index these locale variants and serve the
right one"*; `noindex` says *"don't index this"*. They contradict each other. Search Console
reports both ends of the cluster: *"Noindex URL has incoming hreflang"* and *"Has outgoing
hreflang annotations to noindex URLs"*. Google then ignores the whole hreflang cluster.

**How it's enforced:** `Base.astro` only renders `<link rel="alternate" hreflang>` when the
page is **not** `noindex`:

```astro
{!noindex && alternates.map(alt => (
  <link rel="alternate" hreflang={alt.hreflang} href={alt.href} />
))}
```

So you can keep passing `alternates` to a `noindex` page - the UI language switcher still
uses them (`langHrefs`), but the SEO `<link>` tags are suppressed automatically. **Do not
remove `alternates` from noindex pages** (that would break the language switcher), and **do
not** manually re-add hreflang `<link>` tags on them.

**The current `noindex` pages** (legal/support - intentionally not indexed):
`/terms/`, `/pt/terms/`, `/dolarmap/terms/`, `/pt/dolarmap/terms/`,
`/dolarmap/privacy/`, `/pt/dolarmap/privacy/`, `/dolarmap/support/`, `/pt/dolarmap/support/`.

These are also already excluded from the sitemap via the `filter` in `astro.config.mjs`.
If you add a new `noindex` page, add it to that `filter` too.

**Verify before commit:**

```bash
npm run build
# Every noindex page should report hreflang_links:0
for f in terms pt/terms dolarmap/support pt/dolarmap/support \
         dolarmap/terms pt/dolarmap/terms dolarmap/privacy pt/dolarmap/privacy; do
  echo "$f → hreflang_links: $(grep -c 'rel=\"alternate\" hreflang' dist/$f/index.html)"
done
```

---

## 3. General hreflang hygiene (pre-existing rules - keep following them)

- **Only point `hreflang` at pages that actually exist in production.** Pointing at a
  not-yet-shipped counterpart is a Search Console error. Provide `alternates` only when both
  the EN and PT variants are live.
- **Always include `x-default`**, pointing to the EN variant. (The sitemap `serialize()` in
  `astro.config.mjs` adds `x-default` automatically for sitemap entries; for in-page
  `alternates` props, include it explicitly - see the examples in `Base.astro`.)
- **Use `pt-BR`**, not `pt`, as the Portuguese hreflang code.
- **`canonical` must be the trailing-slash absolute URL** (`https://bitsark.com/foo/`).

---

## 4. Heading hierarchy - start at `<h1>`, exactly one `<h1>`, never skip a level

**The rule:** the **first heading in the DOM** must be the page `<h1>`, there must be
**exactly one `<h1>`** per page, and heading levels must descend by **at most one step**
(`h1 → h2 → h3`, never `h1 → h3`). SiteChecker reports any violation as
*"Headings hierarchy is broken."*

**Why it matters:** Google and assistive tech build a document outline from the heading
levels. A skipped level (or a first heading that isn't `h1`) makes the outline ambiguous,
hurts accessibility, and is a ranking-relevant on-page signal.

**Two non-obvious traps that bit us (both fixed - don't reintroduce them):**

1. **A heading element used purely as an ARIA label, sitting before the `<h1>`.**
   `MobileMenu.astro` labels its `role="dialog"` via `aria-labelledby="bm-title"`. That
   element used to be an `<h2>` and renders in the DOM **before** every page's `<h1>`, so
   the crawler saw `h2` as the document's first heading on **all** pages.
   **Fix / rule:** a dialog/region label does **not** need to be a heading - `aria-labelledby`
   works with any element. Use `<p>` (or `<span>`) for sr-only labels that live above the
   `<h1>`. Never put an `<h2>`–`<h6>` in the layout/nav/menu chrome above `<main>`.

2. **A section whose only titles are the `<h3>` of its child cards, with no `<h2>` of its own.**
   The exchange `[slug].astro` "operational + fees" section had two `<h3>` cards right after
   the `<h1>` (exchange name) - `h1 → h3`, a skipped level. **Fix / rule:** give the section
   a real `<h2>`. If the design has no visible section title, add a **`<h2 class="sr-only">`**
   (visually hidden, see `.sr-only` in `global.css`) and label the section with
   `aria-labelledby` pointing at it. This keeps the visual design identical while repairing
   the outline.

**How to stay correct:** when adding markup, count levels from the page `<h1>` down. Card /
sub-component titles are `<h3>` only if a real `<h2>` (visible or `.sr-only`) heads their
section. Never use a heading tag for non-outline text (labels, eyebrows, badges) - use `<p>`
/ `<span>` and style it.

**Verify before commit:**

```bash
npm run build
# Reports any page that doesn't start at h1, has ≠1 h1, or skips a level.
# Strips HTML comments first so commented-out <h2> notes don't false-positive.
node -e '
const fs=require("fs"),path=require("path");
const walk=(d,a=[])=>{for(const e of fs.readdirSync(d)){const p=path.join(d,e);
  fs.statSync(p).isDirectory()?walk(p,a):e.endsWith(".html")&&a.push(p)}return a};
let bad=0;
for(const f of walk("dist").sort()){
  let h=fs.readFileSync(f,"utf8").replace(/<!--[\s\S]*?-->/g,"");
  const t=[...h.matchAll(/<h([1-6])[\s>]/g)].map(m=>+m[1]);
  if(!t.length)continue;
  const iss=[];
  if(t[0]!==1)iss.push(`starts h${t[0]}`);
  const n=t.filter(x=>x===1).length; if(n!==1)iss.push(`${n} h1s`);
  for(let i=1;i<t.length;i++) if(t[i]>t[i-1]+1) iss.push(`skip h${t[i-1]}->h${t[i]}`);
  if(iss.length){bad++;console.log("BROKEN",f.replace(/^dist[\\/]/,""),iss.join("; "))}
}
console.log(bad?`\n${bad} broken`:"\nOK: all pages valid");
'
```

---

## 5. Data `<table>` MUST have a `<caption>`

**The rule:** every `<table>` that presents data carries a `<caption>` as its **first child**
(immediately after `<table>`, before `<thead>`). SiteChecker reports the absence as
*"Page has `<table>` but has no `<caption>`."*

**Why it matters:** the `<caption>` is the table's accessible name and a content signal that
tells crawlers and screen-reader users what the table contains. It's the standards-correct
way to title a table (better than relying on a nearby `<h2>` or a wrapper `aria-label`).

**How to stay correct:**

- Add the caption right after the opening `<table>` tag:
  `<table …><caption class="sr-only">{describe the table}</caption><thead>…`
- **Keep it visually hidden** with `class="sr-only"` (defined in `global.css`) so the existing
  visual design is untouched - `<caption>` is sr-only-safe.
- **Reuse an existing i18n string** for the text: the section's `.title` key, the wrapper's
  `aria-label`, or the comparison heading. Don't invent a new visible title. Examples in use:
  - `/exchanges/` list table → `t.exchanges.table.ariaLabel`
  - `/exchanges/decripto/` table → `t.decripto.table.title`
  - each `/exchanges/api/` reference table → its section `…title` key
- If a table is genuinely presentational (layout only - we have none), it shouldn't be a
  `<table>` at all; use CSS. Don't add an empty caption to silence the warning.

**Verify before commit:**

```bash
npm run build
# Every data table should have a matching caption. Per-page table vs caption parity:
for f in exchanges/api exchanges/decripto exchanges/index \
         pt/exchanges/api pt/exchanges/decripto pt/exchanges/index; do
  t=$(grep -oc '<table' "dist/$f/index.html"); c=$(grep -oc '<caption' "dist/$f/index.html")
  echo "$f  tables=$t  captions=$c"
done
```

---

## Quick pre-commit checklist for any new/edited page

1. All internal links end with `/` (run the sweep in §1).
2. If the page is `noindex`, it emits zero hreflang `<link>` tags (run the check in §2) and
   is added to the sitemap `filter`.
3. `hreflang` (if any) only points at live pages, includes `x-default`, uses `pt-BR`.
4. `canonical` is the absolute trailing-slash URL.
5. Heading outline is valid (run the check in §4): first heading is `<h1>`, exactly one
   `<h1>`, no skipped levels. No heading tags in nav/menu/footer chrome above `<main>`.
6. Every data `<table>` has a `<caption>` as its first child (run the check in §5).
7. `npm run build` passes, and `npm run check-links` reports all `l()` paths resolve.
