# Language Suggestion Banner (LangBanner)

## Context

`bitsark.com` defaults to English — that URL lives in canonical registrations (Google Play Store, LinkedIn, portfolio links) and targets foreign recruiters. However, the primary audience is Brazilian and arrives already knowing Portuguese. Without a nudge, most Brazilians browse the EN version without knowing `/pt/` exists.

The banner closes that gap: it surfaces the PT version **once**, to users whose browser signals Portuguese preference, and then gets out of the way permanently.

---

## Behaviour — when the banner appears

All four conditions must be true simultaneously:

| # | Condition | Checked where |
|---|-----------|---------------|
| 1 | Page is English (not `/pt/*`) | Server-side SSG gate in `Base.astro` — component is not rendered at all on PT pages |
| 2 | `navigator.language` or any entry in `navigator.languages` starts with `"pt"` | Client JS in `LangBanner.astro` script |
| 3 | `localStorage['lang-banner-dismissed']` is not `'1'` | Client JS — written on any dismissal action |
| 4 | `localStorage['lang-choice-made']` is not `'1'` | Client JS — written whenever user explicitly clicks a language picker |

If any condition is false → banner stays `hidden`, no layout change.

---

## Behaviour — when the banner disappears

There are three dismissal paths. All three write `lang-banner-dismissed = '1'` to `localStorage` and trigger the fade-out + DOM removal:

| Action | Key written | Why |
|--------|-------------|-----|
| Click **"Ver em português"** (CTA link) | `lang-banner-dismissed = '1'` | User made their choice; navigates to `/pt/`. Also sets `lang-choice-made = '1'` via the `[data-lang-choice]` listener (same click). |
| Click **"Manter em inglês"** (keep button) | `lang-banner-dismissed = '1'` | Explicit verbal dismissal. |
| Click **×** (close button) | `lang-banner-dismissed = '1'` | Silent dismissal. |
| Press **Escape** while banner is focused | `lang-banner-dismissed = '1'` | Keyboard accessibility. |

After dismissal, the banner is removed from the DOM (not just hidden). On the next page load, the script reads `lang-banner-dismissed = '1'` and exits without touching the element → zero layout impact.

---

## The two localStorage keys

```
lang-banner-dismissed   '1' | absent
lang-choice-made        '1' | absent
```

### Why two keys?

`lang-banner-dismissed` covers *this specific banner*: it was shown, acknowledged, done.

`lang-choice-made` covers *any explicit language decision*: it is written whenever the user clicks **any** `[data-lang-choice]` element — the nav desktop picker (EN/PT), the mobile menu picker, or the banner CTA. This key persists across sessions and prevents us from re-asking someone who actively chose a language in a previous visit, even if they navigate to the EN site directly (e.g. via an old bookmark or external link).

**Together they answer different questions:**
- `lang-banner-dismissed = '1'` → "The user has seen this specific prompt and responded."
- `lang-choice-made = '1'` → "This user has explicitly chosen a language at some point in their history with the site."

The banner hides if *either* key is present.

### What if I need to reset for testing?

Open DevTools → Application → Local Storage → delete both keys, then hard-reload.

---

## Architecture

### Server-side gate (SSG)

In `Base.astro`, the component is conditionally rendered:

```astro
{normalizedLang === 'en' && (
  <LangBanner ptHref={langHrefs['pt-BR']} />
)}
```

`normalizedLang` is derived from the `lang` prop passed by each page. Pages under `src/pages/pt/` pass `lang="pt-BR"`, so the component never appears in their HTML output. Zero bytes shipped to PT pages.

### PT equivalent URL (`ptHref`)

`langHrefs['pt-BR']` is computed in `Base.astro` from the `alternates` prop:

```ts
const langHrefs: Record<string, string> = {
  'pt-BR': toRelative(alternates.find(a => a.hreflang.startsWith('pt'))?.href) ?? '/pt/',
};
```

- Pages that declare `alternates` (exchanges, dolarmap, stablecoins, about, etc.) → CTA points to the exact PT counterpart (e.g. `/pt/exchanges/`).
- Pages without `alternates` (e.g. 404, any page without a PT version) → CTA falls back to `/pt/` (PT home). Graceful degradation.

### Client script (idempotent, View Transitions compatible)

The script in `LangBanner.astro` uses `is:inline` so it executes immediately after the element is parsed. It registers `initLangBanner()` both on initial run and on `astro:page-load` (required for Astro's View Transitions, which reuse the layout DOM across soft navigations):

```js
initLangBanner();
document.addEventListener('astro:page-load', initLangBanner);
```

Idempotency is enforced via `el.dataset.langInit = '1'` — the function exits early if already initialised on the current element.

### `[data-lang-choice]` listener

A capture-phase click listener is registered once on `document` (guarded by `document.__bsLangChoiceBound`) in `Base.astro`'s persistence script. It fires before navigation completes:

```js
document.addEventListener('click', function(ev) {
  const target = ev.target.closest('[data-lang-choice]');
  if (!target) return;
  localStorage.setItem('lang-choice-made', '1');
}, { capture: true });
```

`data-lang-choice` is stamped on:
- Desktop nav lang links (`Base.astro` — two instances for DolarMap/non-DolarMap layouts)
- Mobile menu lang links (`MobileMenu.astro`)
- The banner CTA `<a>` (`LangBanner.astro` — so clicking "Ver em português" counts as an explicit choice too)

---

## Files changed

| File | What changed |
|------|-------------|
| `src/components/LangBanner.astro` | **New.** Component with markup, scoped styles, and client script. |
| `src/layouts/Base.astro` | Import `LangBanner`; conditional mount before `<nav>`; `data-lang-choice` on desktop lang links (×2); `lang-choice-made` capture listener in persistence script. |
| `src/components/MobileMenu.astro` | `data-lang-choice` on mobile lang links. |
| `src/i18n/pt.json` | Added `langBanner` key block for future reuse (component doesn't depend on it — texts are hardcoded in PT since the banner always addresses a PT speaker). |

---

## Decisions and trade-offs

### Texts hardcoded in PT, not in `en.json`

The banner exclusively addresses a Portuguese-speaking visitor who landed on an English page. There's no scenario where an English speaker reads the banner text. Adding Portuguese strings to `en.json` would corrupt the "EN dict is the source-of-truth" invariant used for TypeScript type inference in `src/i18n/index.ts`. The `langBanner` block in `pt.json` serves as documentation and future reuse reference.

### `navigator.language` only — no server-side geolocation

We chose client-side `navigator.language`/`navigator.languages` detection instead of Cloudflare's `CF-IPCountry` header (which would require a Cloudflare Function to inject into static pages). Reasons:

- **No infrastructure change.** Site remains pure SSG.
- **Covers Brazilians abroad.** A Brazilian in Portugal or the US has a PT browser locale and gets the nudge; an IP-based approach would miss them.
- **Simpler to test and reason about.** Override in DevTools → Sensors → Locales.

Trade-off accepted: misses Brazilians who use en-US as their system language. Considered acceptable — they've actively chosen English.

### No automatic redirect

The banner *suggests*, it never redirects. Automatic redirect based on language/location is a known anti-pattern: breaks bookmarks, confuses users who deliberately chose the EN version, and can cause redirect loops with cached responses. The user stays in control.

### Banner position: before `<nav>` in document flow

The sticky nav is `position: sticky; top: 0`. Placing the banner *above* it in the DOM keeps the banner in normal document flow — it scrolls out of view as the user engages with the page, while the nav remains fixed. This produces the "one chance to see it, then it's gone" behaviour without covering content persistently.

Alternative considered: inside the nav (always visible). Rejected — too persistent for something that should feel like a one-time system message.

### `hidden` attribute for zero CLS/FOUC

The component ships `hidden` in the static HTML. JavaScript reveals it by unsetting `hidden` and adding `is-visible` (with a `requestAnimationFrame` tick between them to allow the CSS transition to fire). If JS is disabled, the banner never appears — clean progressive enhancement.

### Dismissal removes the element from the DOM

`el.remove()` is called after the fade-out transition. This ensures:
- No layout footprint after dismissal.
- No re-layout risk if the browser reflags the element.
- Clean slate for View Transitions re-renders (the component is re-mounted from SSG HTML on each soft navigation and checks `localStorage` immediately).

---

## Testing

### Manual (DevTools)

1. DevTools → Sensors → Locales → `pt-BR`, hard reload `/` → banner should appear.
2. Click "Manter em inglês" → banner fades out, `lang-banner-dismissed = '1'` in Application → Local Storage.
3. Reload → banner stays hidden.
4. Clear localStorage. Click "Ver em português" → navigates to `/pt/`, both `lang-banner-dismissed = '1'` and `lang-choice-made = '1'` set.
5. Navigate back to `/` → banner does not reappear.
6. Clear localStorage. Set Locales to `en-US` → reload `/` → banner does not appear.
7. Visit `/pt/` with any locale → banner is absent from the DOM entirely (view source).

### Automated (Playwright)

A verification script was written and run during implementation:
`C:/Users/rdsri/AppData/Local/Temp/lang-banner-verify/verify.mjs`

9/9 tests passed:
- pt-BR browser on `/` → banner visible, above nav, correct text/CTAs
- `/pt/` → banner absent from DOM
- localStorage initially clean
- "Manter em inglês" → dismissal + `lang-banner-dismissed=1` + no reappear on reload
- "Ver em português" → `/pt/` navigation + both keys set + no reappear on return to `/`
- en-US browser → banner hidden
- Desktop nav lang picker click → `lang-choice-made=1`
- Pre-existing `lang-choice-made=1` blocks banner on reload
- CTA on `/exchanges/` → href is `/pt/exchanges/` (not just `/pt/`)

---

## Known limitation (pre-existing)

The `preferred-lang` persistence script in `Base.astro` only fires on hard page loads. During soft Astro View Transitions navigations (EN → PT), `preferred-lang` in localStorage is not updated until the next hard reload. This is unrelated to the banner (which has its own `astro:page-load` rebinding) and predates this feature. It only affects the 404 page language swap, which reads `preferred-lang` as a hint — not a breaking issue.
