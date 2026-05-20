# Cloudflare — Configuração Padrão-Ouro (bitsark.com)

> **Última revisão:** 2026-05-19
> **Plano que originou este doc:** `~/.claude/plans/quero-um-planejamento-de-dreamy-ullman.md`
> **Por que existe:** se algum comportamento estranho aparecer (cache servindo versão velha, redirect quebrado, latência alta, bot bloqueando crawler de IA, TLS handshake falhando), comece olhando aqui antes de mexer em código.

---

## 1. Topologia

| Componente | Onde | Notas |
|---|---|---|
| **Site estático** | Cloudflare Pages | Astro build, output static, sem adapter |
| **Domínio raiz** | `bitsark.com` (proxied) | apex via Pages |
| **www** | `www.bitsark.com` → `bitsark.com` 301 | via [`public/_redirects`](../../public/_redirects) |
| **CDN de assets** | `assets.bitsark.com` | logos SVG |
| **API pública** | `api.bitsark.com` | usado pelo site e pela função `feedback` |
| **API do app DolarMap** | `apidolarmap.bitsark.com` | uso exclusivo do app mobile |
| **Status** | `status.bitsark.com` | BetterStack uptime |
| **Pages Function** | [`functions/feedback.js`](../../functions/feedback.js) | KV rate-limit + Resend email |

Tudo na **mesma zona Cloudflare** (`bitsark.com`). Cache Rules e WAF Rules são da zona inteira — por isso filtramos por `http.host` em cada regra (ver §4).

---

## 2. Fonte de verdade vs. dashboard

Há **duas fontes** que entregam headers/cache. Saber qual manda em quê é crítico para debug:

| Camada | Arquivo / Local | Manda em |
|---|---|---|
| **Origin (Pages)** | [`public/_headers`](../../public/_headers) | `Cache-Control` por path, CSP, HSTS (2 anos), Permissions-Policy, X-Frame-Options |
| **Edge (Cloudflare)** | Dashboard → Caching → Cache Rules | Override de TTL no edge, bypass cache, escopo por hostname |
| **Edge (Cloudflare)** | Dashboard → SSL/TLS → HSTS | HSTS em respostas que o edge gera *antes* de chegar ao Pages (4xx/5xx do edge) — **12 meses** (máximo do painel) |
| **Edge (Cloudflare)** | Dashboard → Security → WAF | Bloqueios, managed ruleset, custom rules |

**Divergência conhecida (não é bug):** `_headers` declara HSTS `max-age=63072000` (2 anos), o painel da Cloudflare está com `12 meses` (máximo permitido pela UI). Para respostas que o Pages serve, browser recebe **2 anos**. Para erros gerados no edge sem chegar ao Pages, browser recebe **12 meses**. Ambos com `includeSubDomains` e `preload`. Browser pega o **último** header recebido, então na prática o que vale é o do Pages para tráfego normal. Não alterar `_headers` para baixar para 12 meses — preload list aceita ≥1 ano e 2 anos dá maior margem.

---

## 3. Speed / Optimization — decisões

| Setting | Estado | Por quê |
|---|---|---|
| Auto Minify (HTML/CSS/JS) | **OFF** | Deprecated pela Cloudflare. E HTML minify quebraria nosso uso massivo de `<Fragment set:html>` em [`src/pages/dolarmap/index.astro`](../../src/pages/dolarmap/index.astro), [`src/layouts/Base.astro`](../../src/layouts/Base.astro), terms, about, stablecoins. Astro já minifica o que dá. |
| Brotli | **ON** | Default sempre. Melhor que gzip para texto. |
| Early Hints (103) | **ON** | Funciona porque [`src/layouts/Base.astro:205-206`](../../src/layouts/Base.astro#L205-L206) tem `<link rel="preload">` para as duas fontes Geist. Cloudflare detecta e promove a 103. |
| Speed Brain | **ON** | Speculation Rules API. Free. Ajuda return visitors. |
| Cloudflare Fonts | **OFF** | Nós self-hostamos `GeistVF.woff2` e `GeistMonoVF.woff2`. |
| Rocket Loader | **OFF** | Atrasa scripts e tem chance de quebrar hidratação do Astro. |
| RUM (Real User Measurements) | **OFF** | Não medimos via Cloudflare RUM. Se for medir field-data, usar Web Analytics ou CrUX. |
| Tiered Cache | **ON (Smart Tiered Cache Topology)** | Reduz hits ao Pages origin em até ~60% para tráfego global. |
| Crawler Hints (IndexNow) | **ON** | Notifica Bing/Yandex sobre mudanças. Free, ajuda SEO em motores alternativos. |
| **Polish / Mirage** | **OFF (não pagar)** | Astro já gera AVIF/WebP no build via Sharp. Polish seria pagar pelo que já fazemos melhor no build. |
| **APO** | **OFF / não aplicável** | APO é para WordPress. |

---

## 4. Caching — Configuration

| Setting | Valor |
|---|---|
| Browser Cache TTL | **Respect Existing Headers** (casa com `_headers` immutable) |
| Caching Level | Standard |
| Always Online | **OFF** |

**Por que Always Online OFF:** o site exibe dados financeiros voláteis em `/dolarmap` e `/stablecoins-brasil`. Always Online serviria cópia arquivada (Wayback) durante outage — servir cotações antigas como se fossem atuais é pior do que mostrar erro.

---

## 5. Cache Rules (final, com hostname filter)

Todas as regras estão **escopadas por `http.host`**. Sem o filtro, regras "do site" afetariam subdomínios de API.

### 5.1 Site `/_astro/*` — assets hashed
```
Expression: (http.host eq "bitsark.com" and starts_with(http.request.uri.path, "/_astro/"))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Override origin, TTL = 1 year
```

### 5.2 Site — mídia estática (imagens, vídeos, fontes)
```
Expression: (http.host eq "bitsark.com" and http.request.uri.path.extension in {"webp" "avif" "png" "jpg" "jpeg" "gif" "svg" "ico" "mp4" "webm" "woff2"})
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Respect origin TTL
```
> **Histórico:** versão anterior usava `wildcard r"*.{png,jpg,...}"`. Cloudflare wildcards **não suportam brace expansion**. A regra só funcionava por acidente nas duas primeiras cláusulas `or`. Sempre usar `http.request.uri.path.extension in {...}` — é o campo dedicado, mais rápido e correto.

> **Aviso DNS de `.webp`:** se aparecer "Your DNS configuration may not be proxying traffic for .webp" — é falso positivo enquanto bitsark.com está proxied (laranja). Não bloquear deploy por isso.

### 5.2b `assets.bitsark.com` — logos SVG imutáveis
Regra 1 - Cache Rules:
```
Expression: (http.host eq "assets.bitsark.com" and starts_with(http.request.uri.path, "/logos/"))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Override origin, TTL = 1 year
```
> **Por que regra separada e não na §5.2:** `assets.bitsark.com` é um hostname diferente — misturar dois hostnames numa regra dificulta debug. Regra dedicada torna o escopo explícito.

Regra 2 - Cache Response Rules:
```
Expression: (http.host eq "assets.bitsark.com" and starts_with(http.request.uri.path, "/logos/"))
Modify cache-control directives: yes
Action - Add directive; Directive - immutable; Cloudflare only -> OFF
Action - Add directive; Directive - max-age; Duration (seconds) - 31536000; Cloudflare only -> OFF
Action - Add directive; Directive - public; Cloudflare only -> OFF
```

### 5.3 Site — sitemap/robots (TTL curto)
```
Expression: (http.host eq "bitsark.com" and (http.request.uri.path eq "/robots.txt" or starts_with(http.request.uri.path, "/sitemap")))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 2 hours
Browser TTL: Respect origin TTL
```

### 5.4 API DolarMap — bypass para endpoints privados
```
Expression: (http.host eq "apidolarmap.bitsark.com" and (
    starts_with(http.request.uri.path, "/api/alerts") or
    starts_with(http.request.uri.path, "/api/auth") or
    http.request.uri.path eq "/health" or
    http.request.headers["x-internal-key"][0] eq "ZhLDAXEO!kk/69T6*M1.U4|my%oMsP@2"
))
Eligible for cache: no (Bypass cache)
Browser TTL: Bypass cache
```

### 5.5 API DolarMap — endpoints públicos cacheáveis
```
Expression: (http.host eq "apidolarmap.bitsark.com" and (
    starts_with(http.request.uri.path, "/api/prices/") or
    starts_with(http.request.uri.path, "/api/arb/") or
    starts_with(http.request.uri.path, "/api/exchange/") or
    http.request.uri.path eq "/api/live-summary"
))
Eligible for cache: yes
Edge TTL: respeitar valor escolhido (definido por endpoint)
Browser TTL: respect origin
```

**Campos opcionais que ficaram default em todas:** Cache key, Serve stale while revalidating, Respect strong ETags, Origin error page pass-through. Mudar apenas se houver problema concreto.

---

## 6. Network

| Setting | Estado |
|---|---|
| HTTP/3 (com QUIC) | ON |
| 0-RTT Connection Resumption | ON |
| IPv6 Compatibility | ON |

---

## 7. SSL/TLS

| Setting | Valor | Por quê |
|---|---|---|
| SSL/TLS Mode | **Full (Strict)** | Padrão correto para Pages — TLS end-to-end com validação. |
| Minimum TLS Version | **1.2** | TLS 1.3-mínimo bloqueia silenciosamente Android antigo e algumas integrações de pagamento. TLS 1.2 com ciphers modernas continua seguro; browsers negociam 1.3 mesmo assim. |
| Automatic HTTPS Rewrites | ON | |
| Opportunistic Encryption | ON | |
| **HSTS (Edge)** | **ON — 12 meses, includeSubDomains, preload** | Cobre respostas geradas pelo edge antes do Pages |
| **HSTS (`_headers`)** | **2 anos, includeSubDomains, preload** | Cobre respostas do Pages (maioria do tráfego) |

---

## 8. Security

### Estratégia: **manter conteúdo citável por LLMs**
ChatGPT, Perplexity, Google AI Overviews precisam conseguir crawler o site para nos citar como fonte sobre stablecoins/dolarmap. Por isso:

| Setting | Estado | Por quê |
|---|---|---|
| AI Labyrinth | **OFF** | Não queremos confundir crawlers de IA |
| Block AI Bots | **Do not block** | Queremos aparecer em AI Overviews / Perplexity |
| Bot Fight Mode | **OFF** | Falsos positivos com crawlers benignos seriam piores que scrapers |
| Cloudflare Managed Ruleset | **ON** | WAF base gratuito |
| Continuous Script Monitoring | OFF | Pago |
| Email Address Obfuscation | OFF | Usamos [`src/components/EmailObfuscated.astro`](../../src/components/EmailObfuscated.astro) |
| Hotlink Protection | OFF | Assets em `assets.bitsark.com` precisam ser embutíveis |
| HTTP DDoS Attack Protection | ON | |
| Replace Insecure JS Libraries | ON | |
| Security.txt | OFF | |
| Schema Validation | OFF | Reavaliar quando publicarmos OpenAPI spec em `api.bitsark.com/v1/openapi.json` |
| Challenge Passage | 30 min | |
| robots.txt | **Disabled Cloudflare's robots.txt** | Usamos [`public/robots.txt`](../../public/robots.txt) |

### WAF Custom Rules

**Block scanners** — reduz ruído em logs e poupa banda:
```
Expression: (http.host eq "bitsark.com" and (
    starts_with(http.request.uri.path, "/wp-") or
    starts_with(http.request.uri.path, "/.env") or
    starts_with(http.request.uri.path, "/.git") or
    http.request.uri.path eq "/xmlrpc.php" or
    starts_with(http.request.uri.path, "/admin")
))
Action: Block
```

---

## 9. Se quebrar, olhe aqui

| Sintoma | Causa provável | Onde investigar |
|---|---|---|
| CSS/JS antigo após deploy | Cache Rule §5.1 com TTL 1 ano + hash do `/_astro/` não mudou | Verificar build gerou novos hashes; purge by URL no painel Cloudflare se necessário |
| Imagens não atualizam | Cache Rule §5.2 com TTL 1 ano | Mesma coisa — renomeie o asset ou purge URL |
| Página com `<Fragment set:html>` com whitespace estranho | Alguém ativou Auto Minify HTML | Speed → Optimization → confirmar OFF |
| Visitante reporta "site não carrega" em Android antigo | Min TLS 1.3 reativado | SSL/TLS → confirmar 1.2 |
| Perdemos posição em AI Overviews / Perplexity | Bot Fight Mode ou Block AI Bots ON | Security → confirmar ambos OFF |
| Função `feedback` retornando 429 | Rate-limit KV (1 req/min/IP) — não é Cloudflare config | [`functions/feedback.js`](../../functions/feedback.js) |
| Sitemap servindo versão velha após deploy | Cache Rule §5.3 com TTL 2h | Esperar 2h ou purge |
| API DolarMap retornando dados em cache quando deveria ser fresh | Endpoint caiu na regra §5.5 sem querer | Verificar path bate só com os listados em §5.4/§5.5 |
| SVGs de `assets.bitsark.com` sem cache (PSI reclama) | Cache Rule §5.2b ausente ou Transform Rule recriada no lugar errado | Confirmar §5.2b existe; deletar qualquer Transform Rule "Modify Response Header" para `/logos/` |
| HSTS reclamando no hstspreload.org | `_headers` diz 2 anos, painel diz 12 meses — preload list lê do header que chega | Garantir `_headers` permanece em 63072000 |
| Cache Rule "expressão inválida" ao salvar | Tentativa de usar brace `{a,b}` em wildcard | Usar `http.request.uri.path.extension in {...}` |

---

## 10. Verificação end-to-end

Após mudar qualquer item, validar:

```powershell
# 1. TLS 1.2 funciona
curl --tls-max 1.2 -I https://bitsark.com

# 2. Mídia estática cacheada 1 ano
curl -I https://bitsark.com/og-default.png
# Esperado: cf-cache-status: HIT (após 2ª request), cache-control: max-age=31536000

# 3. WAF bloqueia scanners
curl -I https://bitsark.com/.env
# Esperado: HTTP/2 403

# 4. HSTS presente
curl -I https://bitsark.com | findstr /I "strict-transport"
# Esperado: max-age=63072000; includeSubDomains; preload

# 5. Sitemap TTL curto
curl -I https://bitsark.com/sitemap-index.xml
# Esperado: cf-cache-status presente, ttl ~2h

# 6. /_astro/ imutável
curl -I https://bitsark.com/_astro/[hash].css
# Esperado: cache-control: public, max-age=31536000, immutable
```

**Visual:**
- Chrome DevTools → Network → header `103 Early Hints` deve aparecer antes do `200` em navegações cold.
- PageSpeed Insights (CrUX field-data): meta LCP < 2.5s mobile, INP < 200ms, CLS < 0.1. Comparar antes/depois de mudanças significativas em janela de 28 dias.

---

## 11. O que NÃO ativar (decisões deliberadas)

- **Polish / Mirage** — pagar pelo que o build do Astro já entrega melhor (AVIF/WebP via Sharp, cacheado normalmente no CDN).
- **APO** — é para WordPress.
- **Auto Minify HTML** — risco com `<Fragment set:html>` e blocos `<script is:inline>`.
- **Min TLS 1.3** — perde Android antigo no Brasil sem ganho real.
- **Always Online** — site financeiro não deve servir cópia arquivada de cotações.
- **Bot Fight Mode / Block AI Bots** — perde citações em AI search.
- **Cloudflare Fonts** — já self-hostamos com preload.
- **Rocket Loader** — quebra hidratação Astro.
- **Hotlink Protection** — bloqueia uso legítimo de `assets.bitsark.com`.

---

## 12. Próximas decisões (parking lot)

- **Schema Validation (API Shield)** para `api.bitsark.com/v1/`: ativar quando tivermos OpenAPI spec publicada. Free tier limita a 10 endpoints.
- **Email Routing** para receber em `feedback@bitsark.com` ou similar: hoje usamos Resend via Pages Function; Email Routing é free e simplificaria.
- **Cloudflare Web Analytics**: alternativa free ao GA4 se quisermos dados de campo sem cookies. RUM real, sem JS injection.
