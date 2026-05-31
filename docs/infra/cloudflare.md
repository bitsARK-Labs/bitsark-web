# Cloudflare - Configuração Padrão-Ouro (bitsark.com)

> **Última revisão:** 2026-05-31 (canonicalização de URL: 5 Redirect Rules nomeadas, Always-Use-HTTPS OFF, matriz medida em produção - ver §5.2c)
> **Plano que originou este doc:** `~/.claude/plans/quero-um-planejamento-de-dreamy-ullman.md`
> **Por que existe:** se algum comportamento estranho aparecer (cache servindo versão velha, redirect quebrado, latência alta, bot bloqueando crawler de IA, TLS handshake falhando), comece olhando aqui antes de mexer em código.

---

## 1. Topologia

| Componente | Onde | Notas |
|---|---|---|
| **Site estático** | Cloudflare Pages | Astro build, output static, sem adapter |
| **Domínio raiz** | `bitsark.com` (proxied) | apex via Pages |
| **www** | `www.bitsark.com` → `bitsark.com` 301 | Pages → Custom domains → adicionar `www.bitsark.com` (Cloudflare cria CNAME + SSL). Redirect real: **Redirect Rules §5.2c regras 2 e 4** (`[www] path-ok` e `[www] no-slash`; não `_redirects` - ignorado em custom domain) |
| **CDN de assets** | `assets.bitsark.com` | logos SVG |
| **API pública** | `api.bitsark.com` | usado pelo site e pela função `feedback` |
| **API do app DolarMap** | `apidolarmap.bitsark.com` | uso exclusivo do app mobile |
| **Status** | `status.bitsark.com` (proxied) | BetterStack uptime (origin), Worker SEO (edge) |
| **Worker** | `status-page-seo` | Injeta SEO headers (og:, description) e localização PT/EN sem alterar resposta BetterStack |
| **Pages Function** | [`functions/feedback.js`](../../functions/feedback.js) | KV rate-limit + Resend email |

Tudo na **mesma zona Cloudflare** (`bitsark.com`). Cache Rules e WAF Rules são da zona inteira - por isso filtramos por `http.host` em cada regra (ver §4).

---

## 2. Fonte de verdade vs. dashboard

Há **duas fontes** que entregam headers/cache. Saber qual manda em quê é crítico para debug:

| Camada | Arquivo / Local | Manda em |
|---|---|---|
| **Origin (Pages)** | [`public/_headers`](../../public/_headers) | `Cache-Control` por path, CSP, HSTS (2 anos), Permissions-Policy, X-Frame-Options |
| **Edge (Cloudflare)** | Dashboard → Caching → Cache Rules | Override de TTL no edge, bypass cache, escopo por hostname |
| **Edge (Cloudflare)** | Dashboard → SSL/TLS → HSTS | HSTS em respostas que o edge gera *antes* de chegar ao Pages (4xx/5xx do edge) - **12 meses** (máximo do painel) |
| **Edge (Cloudflare)** | Dashboard → Security → WAF | Bloqueios, managed ruleset, custom rules |

**Divergência conhecida (não é bug):** `_headers` declara HSTS `max-age=63072000` (2 anos), o painel da Cloudflare está com `12 meses` (máximo permitido pela UI). Para respostas que o Pages serve, browser recebe **2 anos**. Para erros gerados no edge sem chegar ao Pages, browser recebe **12 meses**. Ambos com `includeSubDomains` e `preload`. Browser pega o **último** header recebido, então na prática o que vale é o do Pages para tráfego normal. Não alterar `_headers` para baixar para 12 meses - preload list aceita ≥1 ano e 2 anos dá maior margem.

---

## 2b. Worker `status-page-seo` - injeção de SEO para status.bitsark.com

O BetterStack entrega HTML funcional em `status.bitsark.com`, mas **sem SEO headers** (og:, description, locale). Worker `status-page-seo` intercepta respostas.

**Scopo:** Apenas `status.bitsark.com/pt` e `status.bitsark.com/en`. Não altera lógica ou cache da página BetterStack.

---

## 3. Speed / Optimization - decisões

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

## 4. Caching - Configuration

| Setting | Valor |
|---|---|
| Browser Cache TTL | **Respect Existing Headers** (casa com `_headers` immutable) |
| Caching Level | Standard |
| Always Online | **OFF** |

**Por que Always Online OFF:** o site exibe dados financeiros voláteis em `/dolarmap` e `/stablecoins-brasil`. Always Online serviria cópia arquivada (Wayback) durante outage - servir cotações antigas como se fossem atuais é pior do que mostrar erro.

---

## 5. Cache Rules (final, com hostname filter)

Todas as regras estão **escopadas por `http.host`**. Sem o filtro, regras "do site" afetariam subdomínios de API.

### 5.1 Site `/_astro/*` - assets hashed
```
Expression: (http.host eq "bitsark.com" and starts_with(http.request.uri.path, "/_astro/"))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Override origin, TTL = 1 year
```

### 5.2 Site - mídia estática (imagens, vídeos, fontes)
```
Expression: (http.host eq "bitsark.com" and http.request.uri.path.extension in {"webp" "avif" "png" "jpg" "jpeg" "gif" "svg" "ico" "mp4" "webm" "woff2"})
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Respect origin TTL
```
> **Histórico:** versão anterior usava `wildcard r"*.{png,jpg,...}"`. Cloudflare wildcards **não suportam brace expansion**. A regra só funcionava por acidente nas duas primeiras cláusulas `or`. Sempre usar `http.request.uri.path.extension in {...}` - é o campo dedicado, mais rápido e correto.

> **Aviso DNS de `.webp`:** se aparecer "Your DNS configuration may not be proxying traffic for .webp" - é falso positivo enquanto bitsark.com está proxied (laranja). Não bloquear deploy por isso.

### 5.2b `assets.bitsark.com` - logos SVG imutáveis
Regra 1 - Cache Rules:
```
Expression: (http.host eq "assets.bitsark.com" and starts_with(http.request.uri.path, "/logos/"))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 1 year
Browser TTL: Override origin, TTL = 1 year
```
> **Por que regra separada e não na §5.2:** `assets.bitsark.com` é um hostname diferente - misturar dois hostnames numa regra dificulta debug. Regra dedicada torna o escopo explícito.

Regra 2 - Cache Response Rules:
```
Expression: (http.host eq "assets.bitsark.com" and starts_with(http.request.uri.path, "/logos/"))
Modify cache-control directives: yes
Action - Add directive; Directive - immutable; Cloudflare only -> OFF
Action - Add directive; Directive - max-age; Duration (seconds) - 31536000; Cloudflare only -> OFF
Action - Add directive; Directive - public; Cloudflare only -> OFF
```

### 5.2c Canonicalização de URL - 5 Redirect Rules (HTTPS + www + trailing slash + assets)

> **Última revisão desta seção:** 2026-05-31 (matriz medida em produção, 5 regras nomeadas)
> **Objetivo:** toda variante de URL (`http`, `www`, sem barra final) converge para a forma canônica **`https://bitsark.com/<path>/`** com o **mínimo de hops possível**, casando com `<link rel="canonical">`, sitemap, hreflang e `og:url` (todos com barra final, porque `astro.config.mjs` é `trailingSlash: 'always'`).

**Padrão de nome das regras:** `[host-alvo] condição-de-entrada → resultado (Nhop)`. O prefixo `[host]` agrupa visualmente no painel; o sufixo `(Nhop)` documenta o custo direto no nome - se alguém quebrar uma regra e ela virar 2hop, o nome passa a mentir e chama atenção em revisão.

**Decisão estruturante:** o toggle nativo **"Always Use HTTPS" foi DESLIGADO** (SSL/TLS → Edge Certificates). Ele é uma redireção isolada `http→https` que roda *antes* das Redirect Rules e não combina com elas - some um hop. Substituímos por Redirect Rules que hardcodam `https://` no `concat()` de saída, fazendo o upgrade de scheme **junto** com a mudança de host/path. **Não religar** - o toggle reintroduz um hop em todo tráfego `http`.

**Técnica anti-hop (a sacada das 5 regras):** o tráfego de cada host é **particionado em dois casos mutuamente exclusivos** pelo formato do path - (a) já-correto (`termina com /` OU `contém .`) vs. (b) precisa-de-barra (`não termina com /` E `não contém .`). Cada metade aponta direto para o destino final. Isso permite que `www` + sem-barra resolva **host + scheme + barra num único 301** (Regra 4), em vez de cair em www→apex e depois apex→barra. As partições são complementares, então não há gap nem sobreposição - não é lógica duplicada, é divisão de domínio.

As 5 regras vivem em **Rules → Redirect Rules**, nesta ordem. Todas: **Dynamic 301 redirect, Preserve query string ON**.

**Regra 1 - `[apex] http → https (1hop)`** (substitui o toggle nativo Always Use HTTPS)
```
Expression: (http.host eq "bitsark.com" and not ssl)
            [UI: Hostname equals bitsark.com  AND  SSL/HTTPS does not equal "true"]
URL: concat("https://bitsark.com", http.request.uri.path)
```
> Só faz o upgrade de scheme no **apex**. Não adiciona barra - se o path vier sem barra, a Regra 3 termina o serviço no hop seguinte (ver matriz: este é o único caso residual de 2 hops, coberto por HSTS na prática).

**Regra 2 - `[www] path-ok → apex (1hop)`**
```
Expression: (http.host eq "www.bitsark.com"
             and (ends_with(http.request.uri.path, "/") or http.request.uri.path contains "."))
URL: concat("https://bitsark.com", http.request.uri.path)
```
> Metade (a) do tráfego www: path **já correto** (com barra, ex `/exchanges/`, ou arquivo, ex `/style.css`). Faz scheme + host num único 301; não mexe no path porque já está bom.

**Regra 3 - `[apex] add-trailing-slash (1hop)`**
```
Expression: (http.host eq "bitsark.com"
             and not ends_with(http.request.uri.path, "/")
             and not http.request.uri.path contains ".")
URL: concat("https://bitsark.com", http.request.uri.path, "/")
```
> **CRÍTICO - deve ser Redirect Rule (301), NÃO URL Rewrite Rule.** Uma versão anterior usou *URL Rewrite* (reescrita interna): o path sem barra retornava `200 OK` servindo conteúdo idêntico ao da versão com barra - criando uma **URL duplicada indexável** (`/exchanges` e `/exchanges/` ambas 200, mesmo md5). Com `trailingSlash: 'always'` o canônico é a barra, então a duplicata só não vira penalidade graças à tag canonical - mas desperdiça crawl budget e dilui link equity. A Redirect Rule 301 elimina a duplicata. O `not contains "."` evita reescrever assets reais (`/og/exchanges.png`, `/fonts/x.woff2`).

**Regra 4 - `[www] no-slash → apex+slash (1hop)`**  ⭐ otimização que zera o pior caso www
```
Expression: (http.host eq "www.bitsark.com"
             and not ends_with(http.request.uri.path, "/")
             and not http.request.uri.path contains ".")
URL: concat("https://bitsark.com", http.request.uri.path, "/")
```
> Metade (b) do tráfego www: path **sem barra**. Resolve **scheme + host + barra num único 301** (`https://www.bitsark.com/exchanges` → `https://bitsark.com/exchanges/`). Sem esta regra, esse caso cairia na Regra 2... mas a Regra 2 não pega path sem-barra (a condição é complementar), então cairia em www→apex genérico e depois apex→barra = 2 hops. A Regra 4 colapsa em 1. Verificado em produção.

**Regra 5 - `[assets] root → apex (1hop)`**
```
Expression: (http.host eq "assets.bitsark.com" and http.request.uri.path eq "/")
URL: https://bitsark.com/   (destino fixo, não concat)
```
> **Por que existe:** o GSC reportou 404 na raiz do subdomínio (sem conteúdo configurado). O redirect elimina o erro de cobertura sem afetar `/logos/*.svg` (esses são servidos normalmente, ver §5.2b). Regra de redirect, não de cache - não interferir com §5.2b.

#### Matriz de hops (MEDIDA em produção, 2026-05-31)

Toda variante de `https://bitsark.com/exchanges/` (exemplo) converge para o canônico. Valores abaixo são `curl --max-redirs` medido, não teórico:

| URL de entrada | Hops | Regra(s) | Final |
|---|---|---|---|
| `https://bitsark.com/exchanges/` (canônico) | **0** | nenhuma | servido direto (200) |
| `https://bitsark.com/exchanges` | **1** | R3 | `/exchanges/` |
| `https://www.bitsark.com/exchanges/` | **1** | R2 | `/exchanges/` |
| `https://www.bitsark.com/exchanges` | **1** ⭐ | R4 (host+scheme+slash juntos) | `/exchanges/` |
| `https://www.bitsark.com/style.css` | **1** | R2 (path ok, só dropa www) | `/style.css` |
| `http://www.bitsark.com/exchanges` (era pior caso) | **1** ⭐ | R4 (http→https+host+slash juntos) | `/exchanges/` |
| `http://bitsark.com/exchanges` | **2** | R1 → R3 | `/exchanges/` |

**6 dos 7 cenários são 0-1 hop.** O `www` + sem-barra (que já foi 2 hops) hoje é 1 hop graças à Regra 4.

> **O único caso de 2 hops residual (`http://bitsark.com/exchanges`) e por que NÃO o fechamos:** é apex + `http` + sem-barra. A Regra 1 faz só o upgrade `https` (sem barra), e a Regra 3 adiciona a barra no 2º hop. Dava para zerar dividindo a Regra 1 em duas (igual fizemos com www → R2/R4), virando 6 regras. **Decisão deliberada de parar em 5:** o HSTS preload (`_headers`, 2 anos, na preload list) faz o browser fazer upgrade `http→https` **antes de enviar a request** - então qualquer browser moderno começa em `https://bitsark.com/exchanges` e cai direto na R3 = **1 hop efetivo**. Os únicos que veriam 2 hops: browser sem HSTS preload, digitando `http://` explícito, no apex, sem barra. Conjunto microscópico. A 6ª regra aumentaria a superfície de manutenção sem ganho real.

> **Por que a ordem importa e está correta:** as condições são mutuamente exclusivas por host e por formato de path, então não há ambiguidade de qual regra dispara. R1 (apex http) e R3 (apex add-slash) podem ambas casar `http://bitsark.com/sem-barra` - R1 vem primeiro e faz o https; R3 termina. Inverter não ajuda (ver caso residual acima). **NÃO reordenar.**

> **Por que Redirect Rule e não `_redirects`:** quando `www` é Custom Domain no Pages, o Pages serve `200 OK` direto em qualquer path real, ignorando o `_redirects`. A Redirect Rule intercepta no edge, antes do Pages, e funciona para qualquer path. O `_redirects` mantém a linha `www → apex` como fallback documental, mas ela nunca é atingida - as Redirect Rules são a fonte de verdade.

### 5.3 Site - sitemap/robots (TTL curto)
```
Expression: (http.host eq "bitsark.com" and (http.request.uri.path eq "/robots.txt" or starts_with(http.request.uri.path, "/sitemap")))
Eligible for cache: yes
Edge TTL: Ignore cache-control header, TTL = 2 hours
Browser TTL: Respect origin TTL
```

### 5.4 API DolarMap - bypass para endpoints privados
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

### 5.5 API DolarMap - endpoints públicos cacheáveis
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
| SSL/TLS Mode | **Full (Strict) por padrão** | Padrão correto para Pages - TLS end-to-end com validação. |
| SSL/TLS Mode | **Full (sem Strict)** | `status.bitsark.com` apenas - BetterStack origin cert não faz match com hostname. Config Rule: `(http.host eq "status.bitsark.com")`. Sem afetar outros subdomínios. |
| Minimum TLS Version | **1.2** | TLS 1.3-mínimo bloqueia silenciosamente Android antigo e algumas integrações de pagamento. TLS 1.2 com ciphers modernas continua seguro; browsers negociam 1.3 mesmo assim. |
| **Always Use HTTPS** | **OFF (deliberado)** | Desligado em 2026-05-31. O toggle nativo é uma redireção `http→https` isolada que não combina com www/trailing-slash. Substituído pela Redirect Rule 1 (§5.2c), que vive na mesma lista das outras e permite minimizar hops. **Não religar** - reintroduz hop extra em `http://www`. |
| Automatic HTTPS Rewrites | ON | Reescreve `http://` → `https://` em links *dentro* do HTML (subrecursos), independente do redirect de navegação. Mantém. |
| Opportunistic Encryption | ON | |
| **HSTS (Edge)** | **ON - 12 meses, includeSubDomains, preload** | Cobre respostas geradas pelo edge antes do Pages |
| **HSTS (`_headers`)** | **2 anos, includeSubDomains, preload** | Cobre respostas do Pages (maioria do tráfego) |
| **SSL/TLS Config Rule** | `Use SSL Full (not strict) for status.bitsark.com - BetterStack origin cert doesn't match hostname` | Aplica Full (sem Strict) apenas a `status.bitsark.com`; nenhum outro subdomínio afetado |

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

**Block scanners** - reduz ruído em logs e poupa banda:
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
| Imagens não atualizam | Cache Rule §5.2 com TTL 1 ano | Mesma coisa - renomeie o asset ou purge URL |
| Página com `<Fragment set:html>` com whitespace estranho | Alguém ativou Auto Minify HTML | Speed → Optimization → confirmar OFF |
| Visitante reporta "site não carrega" em Android antigo | Min TLS 1.3 reativado | SSL/TLS → confirmar 1.2 |
| Perdemos posição em AI Overviews / Perplexity | Bot Fight Mode ou Block AI Bots ON | Security → confirmar ambos OFF |
| Função `feedback` retornando 429 | Rate-limit KV (1 req/min/IP) - não é Cloudflare config | [`functions/feedback.js`](../../functions/feedback.js) |
| Sitemap servindo versão velha após deploy | Cache Rule §5.3 com TTL 2h | Esperar 2h ou purge |
| API DolarMap retornando dados em cache quando deveria ser fresh | Endpoint caiu na regra §5.5 sem querer | Verificar path bate só com os listados em §5.4/§5.5 |
| SVGs de `assets.bitsark.com` sem cache (PSI reclama) | Cache Rule §5.2b ausente ou Transform Rule recriada no lugar errado | Confirmar §5.2b existe; deletar qualquer Transform Rule "Modify Response Header" para `/logos/` |
| HSTS reclamando no hstspreload.org | `_headers` diz 2 anos, painel diz 12 meses - preload list lê do header que chega | Garantir `_headers` permanece em 63072000 |
| Cache Rule "expressão inválida" ao salvar | Tentativa de usar brace `{a,b}` em wildcard | Usar `http.request.uri.path.extension in {...}` |
| Site "desconfigurado" (sem CSS) **só ao rodar Lighthouse** em aba anônima; reabre normal | **NÃO é Cloudflare.** CSS é inline (`inlineStylesheets: 'always'`), não há como faltar. É o `font-display` sob CPU throttle do Lighthouse esticando o repaint da fonte. | [`src/styles/global.css`](../../src/styles/global.css) - confirmar `font-display: optional` (não `swap`). Ver nota no `@font-face` |
| Warning `GeistVF.woff2 preloaded but not used within a few seconds` | `font-display: swap` adiando aplicação da fonte além da janela pós-`load` | Mesmo arquivo - `optional` + preload (Base.astro) resolve. NÃO remover preload |
| GSC reporta 404 em `assets.bitsark.com/` | Raiz do subdomínio sem conteúdo - Regra 5 `[assets] root → apex` ausente | Rules → Redirect Rules → confirmar a regra 5 de §5.2c existe e está ativa |
| `www.bitsark.com` não resolve (ERR_NAME_NOT_RESOLVED) | Custom domain não cadastrado no Pages | Pages → bitsark-web → Custom domains → adicionar `www.bitsark.com` |
| `www.bitsark.com` serve `200 OK` em vez de redirecionar | Pages serve o site no custom domain, `_redirects` é ignorado para paths reais | Rules → Redirect Rules → confirmar regras `[www] path-ok` (R2) e `[www] no-slash` (R4) existem com `concat("https://bitsark.com", ...)` |
| GSC: "Página com redirecionamento" / duplicatas sem-barra indexadas | Regra 3 `[apex] add-trailing-slash` virou **URL Rewrite** em vez de **Redirect**, servindo `/path` como 200 alias de `/path/` | Rules → confirmar `[apex] add-trailing-slash` é **Redirect Rule 301**, não Rewrite. Testar: `curl -sI https://bitsark.com/exchanges --max-redirs 0` deve dar **301**, não 200 |
| URL sem-barra retorna `200` em vez de `301` | Mesmo problema acima (rewrite no lugar de redirect) | Regra 3 `[apex] add-trailing-slash` - trocar para Dynamic 301 com `concat(..., path, "/")` |
| `www` + sem-barra voltou a dar 2 hops (era 1) | Regra 4 `[www] no-slash → apex+slash` apagada ou desativada - tráfego caiu no fallback www→apex e depois apex→barra | Rules → confirmar R4 ativa. Testar: `curl -sILo NUL -w "%{num_redirects}" https://www.bitsark.com/exchanges` deve dar **1** |
| Pior caso (`http://www...`) com 3 hops | "Always Use HTTPS" nativo religado, somando hop isolado de https antes da R4 | SSL/TLS → Edge Certificates → confirmar **Always Use HTTPS = OFF** (substituído pela R1 `[apex] http → https`) |
| `http://www.../path` redireciona para `http://...` (sem upgrade https) | R2/R4 de §5.2c usando host relativo em vez de `concat("https://...")` | §5.2c R2/R4 - garantir prefixo literal `https://` no `concat` |

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
# Esperado: cache-control: public, max-age=63072000, immutable

# 7. Canonicalização de URL (§5.2c) - matriz de hops
#    Toda variante deve convergir para https://bitsark.com/<path>/ com o
#    mínimo de hops. Use /exchanges como path de teste.

#  7a. Canônico: ZERO hops (servido direto)
curl -sILo NUL -w "hops=%{num_redirects} final=%{url_effective}`n" https://bitsark.com/exchanges/
# Esperado: hops=0  final=.../exchanges/

#  7b. Sem barra (apex+https): 1 hop, R3 [apex] add-trailing-slash
curl -sI https://bitsark.com/exchanges --max-redirs 0 | findstr /I "HTTP location"
# Esperado: 301 -> https://bitsark.com/exchanges/   (NUNCA 200 - se 200, R3 virou Rewrite!)

#  7c. www com barra: 1 hop, R2 [www] path-ok derruba www
curl -sI https://www.bitsark.com/exchanges/ --max-redirs 0 | findstr /I "HTTP location"
# Esperado: 301 -> https://bitsark.com/exchanges/

#  7d. www SEM barra: 1 hop, R4 [www] no-slash resolve host+scheme+barra junto
curl -sILo NUL -w "hops=%{num_redirects} final=%{url_effective}`n" https://www.bitsark.com/exchanges
# Esperado: hops=1  final=https://bitsark.com/exchanges/   (se hops=2 -> R4 sumiu!)

#  7e. http+www+sem barra (era pior caso): 1 hop via R4 (HSTS pré-upgrade ajuda mais ainda)
curl -sILo NUL -w "hops=%{num_redirects} final=%{url_effective}`n" http://www.bitsark.com/exchanges
# Esperado: hops=1  final=https://bitsark.com/exchanges/

#  7f. apex http sem barra: ÚNICO caso de 2 hops residual (R1 -> R3), coberto por HSTS na prática
curl -sILo NUL -w "hops=%{num_redirects} final=%{url_effective}`n" http://bitsark.com/exchanges
# Esperado: hops=2  final=https://bitsark.com/exchanges/   (aceitável - ver §5.2c)

#  7g. "Add trailing slash" é REDIRECT, não Rewrite (regressão crítica)
curl -sI https://bitsark.com/exchanges --max-redirs 0 | findstr /I "HTTP"
# Esperado: HTTP/1.1 301   (se HTTP/1.1 200 -> duplicata indexável, corrigir já)
```

**Visual:**
- Chrome DevTools → Network → header `103 Early Hints` deve aparecer antes do `200` em navegações cold.
- PageSpeed Insights (CrUX field-data): meta LCP < 2.5s mobile, INP < 200ms, CLS < 0.1. Comparar antes/depois de mudanças significativas em janela de 28 dias.

---

## 11. O que NÃO ativar (decisões deliberadas)

- **Polish / Mirage** - pagar pelo que o build do Astro já entrega melhor (AVIF/WebP via Sharp, cacheado normalmente no CDN).
- **APO** - é para WordPress.
- **Auto Minify HTML** - risco com `<Fragment set:html>` e blocos `<script is:inline>`.
- **Min TLS 1.3** - perde Android antigo no Brasil sem ganho real.
- **Always Online** - site financeiro não deve servir cópia arquivada de cotações.
- **Bot Fight Mode / Block AI Bots** - perde citações em AI search.
- **Cloudflare Fonts** - já self-hostamos com preload.
- **Rocket Loader** - quebra hidratação Astro.
- **Hotlink Protection** - bloqueia uso legítimo de `assets.bitsark.com`.
- **Always Use HTTPS (toggle nativo)** - substituído pela R1 `[apex] http → https` (§5.2c) para combinar redireções e minimizar hops. Religar adiciona hop isolado.
- **URL Rewrite Rule para trailing slash** - DEVE ser Redirect Rule 301 (R3 `[apex] add-trailing-slash`, §5.2c). Rewrite cria duplicata 200 indexável.
- **6ª regra para zerar o último 2-hop (`http://bitsark.com/sem-barra`)** - decisão deliberada de parar em 5 regras: HSTS preload já cobre esse resíduo. Ver §5.2c.
- **`font-display: swap` nas fontes Geist** - usar `optional` (§9 / global.css). `swap` reintroduz o flash sob throttle do Lighthouse e o warning "preloaded but not used".

---

## 12. Próximas decisões (parking lot)

- **Schema Validation (API Shield)** para `api.bitsark.com/v1/`: ativar quando tivermos OpenAPI spec publicada. Free tier limita a 10 endpoints.
- **Email Routing** para receber em `feedback@bitsark.com` ou similar: hoje usamos Resend via Pages Function; Email Routing é free e simplificaria.
- **Cloudflare Web Analytics**: alternativa free ao GA4 se quisermos dados de campo sem cookies. RUM real, sem JS injection.
