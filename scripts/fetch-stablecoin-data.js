/**
 * fetch-stablecoin-data.js
 * Coleta dados de mercado global de stablecoins (DefiLlama) e do Brasil (BCB)
 * Grava JSONs em public/data/ para consumo estático pela página /stablecoins-brasil
 *
 * Fontes:
 *   Global: DefiLlama Stablecoins API - agrega ~180 stablecoins USD-pegged em todas as chains
 *           (https://stablecoins.llama.fi/stablecoincharts/all). Free, sem auth.
 *   Brasil: BCB Tabelas Especiais do Balanço de Pagamentos - série "criptoativos com passivo
 *           correspondente". Publicação trimestral em XLSX. Sem API pública estável: o script
 *           tenta uma lista de URLs candidatas; se todas falharem, mantém o seed e o GitHub
 *           Action abre issue automática após 90 dias de fallback contínuo.
 *
 * Execução: node scripts/fetch-stablecoin-data.js
 * Requer:   Node 18+ (fetch nativo), package.json com "type": "module", dependência `xlsx`
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../public/data");
mkdirSync(OUTPUT_DIR, { recursive: true });

const USER_AGENT = "bitsARK-data-pipeline/2.0 (+https://bitsark.com)";

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchWithLabel(url, label, asText = false) {
  console.log(`⬇  Fetching ${label}...`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${label} → HTTP ${res.status}`);
  return asText ? res.text() : res.json();
}

function save(filename, data) {
  const path = join(OUTPUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✅  Saved ${filename} (${JSON.stringify(data).length} bytes)`);
}

function readPrevious(filename) {
  const path = join(OUTPUT_DIR, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthOffset(monthStr, offset) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return monthKey(d);
}

// ─── 1. GLOBAL - DefiLlama stablecoin market cap ────────────────────────────
// Endpoint retorna a série diária do total circulante de stablecoins USD-pegged
// agregado entre todas as ~180 stablecoins rastreadas (USDT, USDC, DAI, USDe,
// PYUSD, FDUSD, TUSD, FRAX, USDD, LUSD, USDP, GUSD, etc.).
// Documentação: https://defillama.com/docs/api

async function fetchGlobalMarketCap() {
  const url = "https://stablecoins.llama.fi/stablecoincharts/all";
  const raw = await fetchWithLabel(url, "DefiLlama /stablecoincharts/all");

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("DefiLlama: resposta vazia ou inesperada");
  }

  // Agregação: pegamos o último datapoint de cada mês (snapshot de fim-de-mês).
  const byMonth = new Map(); // "YYYY-MM" → { ts, cap }
  for (const point of raw) {
    const ts = Number(point.date) * 1000;
    if (!Number.isFinite(ts)) continue;
    const d = new Date(ts);
    const key = monthKey(d);

    const cap =
      point.totalCirculatingUSD?.peggedUSD ??
      point.totalCirculating?.peggedUSD ??
      null;
    if (!Number.isFinite(cap)) continue;

    const existing = byMonth.get(key);
    if (!existing || ts > existing.ts) byMonth.set(key, { ts, cap });
  }

  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { cap }]) => ({ month, marketCapUsd: Math.round(cap) }));

  if (monthly.length === 0) {
    throw new Error("DefiLlama: nenhum datapoint mensal extraído");
  }

  const latest = monthly.at(-1);

  // Sanity check: market cap atual de stablecoins USD-pegged é ~$300bi (mai/2026).
  // Se vier algo radicalmente fora desse range, algo mudou na API e queremos saber.
  if (latest.marketCapUsd < 50e9 || latest.marketCapUsd > 2e12) {
    throw new Error(
      `DefiLlama: latestMarketCapUsd fora do range esperado ($50bi-$2tri): ${latest.marketCapUsd}`
    );
  }

  const yoyMonth = getMonthOffset(latest.month, -12);
  const yoy = monthly.find((d) => d.month === yoyMonth);
  const yoyGrowthPct = yoy
    ? Number(
        (((latest.marketCapUsd - yoy.marketCapUsd) / yoy.marketCapUsd) * 100).toFixed(1)
      )
    : null;

  console.log(
    `✅  DefiLlama: ${monthly.length} meses agregados. Último: ${latest.month} = $${(latest.marketCapUsd / 1e9).toFixed(1)}bi · YoY ${yoyGrowthPct ?? "n/a"}%`
  );

  return {
    updatedAt: new Date().toISOString(),
    source: "DefiLlama Stablecoins API - peggedUSD aggregate (~180 stablecoins, all chains)",
    sourceUrl: "https://defillama.com/stablecoins",
    latestMarketCapUsd: latest.marketCapUsd,
    yoyGrowthPct,
    monthly,
  };
}

// ─── 2. BRASIL - BCB Balanço de Pagamentos ──────────────────────────────────
//
// O BCB publica a série "criptoativos com passivo correspondente" como item de
// memorando das Tabelas Especiais do BP (nota metodológica jul/2024). A série
// é publicada trimestralmente em XLSX no portal de estatísticas. Não há API
// pública estável (a página de Tabelas Especiais é JS-rendered e o filename
// muda a cada publicação).
//
// Estratégia: tentar uma lista de URLs candidatas conhecidas. Se uma delas
// devolver um XLSX válido com a linha de stablecoins, usar. Senão, manter
// o seed e marcar isFallback: true. O Action abre issue se isFallback persistir.

const BCB_XLSX_CANDIDATES = [
  "https://www.bcb.gov.br/content/estatisticas/Documents/Tabela-Especial-BP.xlsx",
  "https://www.bcb.gov.br/content/estatisticas/Documents/Tabelas-Especiais-BP.xlsx",
  "https://www.bcb.gov.br/content/estatisticas/Documents/Tabela_Especial_BP.xlsx",
  "https://www.bcb.gov.br/content/estatisticas/Documents/tab_esp_bp.xlsx",
  "https://www.bcb.gov.br/content/estatisticas/Documents/Tabela_Especial_BPM6.xlsx",
];

const STABLECOIN_LABELS = [
  "com passivo correspondente",
  "criptoativos com passivo",
  "stablecoins",
  "com passivo",
  "moeda digital",
];

async function fetchBrazilData() {
  for (const url of BCB_XLSX_CANDIDATES) {
    try {
      console.log(`⬇  Tentando BCB XLSX: ${url}`);
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) {
        console.warn(`   ↳ HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const parsed = parseBcbXlsx(buf);
      if (parsed) {
        const latest = parsed.monthly.at(-1);
        console.log(
          `✅  BCB XLSX: ${parsed.monthly.length} meses extraídos. Último: ${latest.month} = $${(latest.accumulatedUsd / 1e9).toFixed(1)}bi`
        );
        return {
          updatedAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          source:
            "BCB - Balanço de Pagamentos (Tabelas Especiais, criptoativos com passivo correspondente)",
          sourceUrl: url,
          isFallback: false,
          latestAccumulatedUsd: latest.accumulatedUsd,
          latestMonth: latest.month,
          monthly: parsed.monthly,
        };
      }
    } catch (e) {
      console.warn(`   ↳ erro: ${e.message}`);
    }
  }

  console.warn(
    "⚠️  Nenhuma URL candidata do BCB retornou XLSX válido. Usando seed.\n" +
      "    Se o BCB mudou a URL/layout, atualize BCB_XLSX_CANDIDATES ou STABLECOIN_LABELS."
  );

  // Preserva lastSuccessAt da execução bem-sucedida anterior, para o Action
  // detectar quanto tempo estamos rodando em fallback.
  const previous = readPrevious("stablecoin-brazil.json");
  const lastSuccessAt = previous?.lastSuccessAt ?? null;

  return { ...buildBrazilFallback(), lastSuccessAt };
}

function parseBcbXlsx(buf) {
  let workbook;
  try {
    workbook = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    console.warn(`   ↳ XLSX parse falhou: ${e.message}`);
    return null;
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (!Array.isArray(rows) || rows.length === 0) continue;

    // Procura linha header com datas (formato "jan/19", "dez/2025", etc.)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i].map((c) => String(c ?? "").trim());
      const monthCells = row.filter((c) => parseBCBMonth(c)).length;
      if (monthCells >= 4) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) continue;

    const headers = rows[headerRowIdx].map((c) => String(c ?? "").trim());

    // Procura linha de stablecoins
    let dataRow = null;
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const firstCell = String(rows[i][0] ?? "").toLowerCase();
      if (STABLECOIN_LABELS.some((label) => firstCell.includes(label))) {
        dataRow = rows[i];
        break;
      }
    }
    if (!dataRow) continue;

    const monthly = [];
    let accumulated = 0;
    for (let i = 1; i < headers.length; i++) {
      const month = parseBCBMonth(headers[i]);
      if (!month) continue;
      const raw = String(dataRow[i] ?? "")
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const val = parseFloat(raw);
      if (!Number.isFinite(val)) continue;

      accumulated += val;
      monthly.push({
        month,
        flowUsd: Math.round(val * 1_000_000), // BCB publica em US$ milhões
        accumulatedUsd: Math.round(accumulated * 1_000_000),
      });
    }

    if (monthly.length > 0) return { monthly };
  }

  console.warn(`   ↳ XLSX baixado mas linha de stablecoins não encontrada nas ${workbook.SheetNames.length} abas`);
  return null;
}

function parseBCBMonth(raw) {
  // "jan/19" → "2019-01"  |  "dez/2025" → "2025-12"
  if (!raw) return null;
  const ptMonths = {
    jan: "01", fev: "02", mar: "03", abr: "04",
    mai: "05", jun: "06", jul: "07", ago: "08",
    set: "09", out: "10", nov: "11", dez: "12",
  };
  const m = String(raw).toLowerCase().trim().match(/^([a-z]{3})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const mon = ptMonths[m[1]];
  if (!mon) return null;
  const year = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${year}-${mon}`;
}

// ─── Fallback seed ───────────────────────────────────────────────────────────
// Usado quando nenhuma URL do BCB devolve XLSX válido. Mantemos no script para
// evitar dependência do JSON anterior, mas o Action prioriza o JSON do disco
// (com `lastSuccessAt` preservado) para alertar sobre fallback persistente.

function buildBrazilFallback() {
  const points = [
    { month: "2019-01", flowUsd: 50_000_000 },
    { month: "2019-04", flowUsd: 80_000_000 },
    { month: "2019-07", flowUsd: 130_000_000 },
    { month: "2019-10", flowUsd: 160_000_000 },
    { month: "2020-01", flowUsd: 200_000_000 },
    { month: "2020-04", flowUsd: 320_000_000 },
    { month: "2020-07", flowUsd: 480_000_000 },
    { month: "2020-10", flowUsd: 640_000_000 },
    { month: "2021-01", flowUsd: 900_000_000 },
    { month: "2021-04", flowUsd: 1_400_000_000 },
    { month: "2021-07", flowUsd: 1_700_000_000 },
    { month: "2021-10", flowUsd: 1_900_000_000 },
    { month: "2022-01", flowUsd: 1_800_000_000 },
    { month: "2022-04", flowUsd: 1_600_000_000 },
    { month: "2022-07", flowUsd: 1_200_000_000 },
    { month: "2022-10", flowUsd: 1_100_000_000 },
    { month: "2023-01", flowUsd: 1_400_000_000 },
    { month: "2023-04", flowUsd: 1_700_000_000 },
    { month: "2023-07", flowUsd: 2_100_000_000 },
    { month: "2023-10", flowUsd: 2_400_000_000 },
    { month: "2024-01", flowUsd: 2_800_000_000 },
    { month: "2024-04", flowUsd: 3_300_000_000 },
    { month: "2024-07", flowUsd: 3_900_000_000 },
    { month: "2024-10", flowUsd: 4_500_000_000 },
    { month: "2025-01", flowUsd: 4_200_000_000 },
    { month: "2025-04", flowUsd: 4_600_000_000 },
    { month: "2025-07", flowUsd: 3_100_000_000 },
    { month: "2025-10", flowUsd: 3_400_000_000 },
    { month: "2026-01", flowUsd: 1_500_000_000 },
    { month: "2026-03", flowUsd: 1_440_000_000 },
  ];

  let acc = 0;
  const monthly = points.map(({ month, flowUsd }) => {
    acc += flowUsd;
    return { month, flowUsd, accumulatedUsd: acc };
  });

  return {
    updatedAt: new Date().toISOString(),
    source:
      "BCB seed data (fallback) - dados históricos públicos. Atualizar BCB_XLSX_CANDIDATES ou STABLECOIN_LABELS no script quando a publicação do BCB mudar.",
    sourceUrl: "https://www.bcb.gov.br/estatisticas/tabelasespeciais",
    isFallback: true,
    latestAccumulatedUsd: acc,
    latestMonth: points.at(-1).month,
    monthly,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀  bitsARK stablecoin data pipeline started\n");

  // 1. Dados globais (DefiLlama) - fatal se falhar
  try {
    const global = await fetchGlobalMarketCap();
    save("stablecoin-market.json", global);
  } catch (err) {
    console.error("❌  DefiLlama error:", err.message);
    process.exit(1);
  }

  // 2. Dados Brasil (BCB) - non-fatal, usa fallback se falhar
  try {
    const brazil = await fetchBrazilData();
    save("stablecoin-brazil.json", brazil);
  } catch (err) {
    console.error("❌  BCB data error:", err.message);
    console.warn("⚠️  Brazil data not updated. JSON anterior preservado pelo Action.");
  }

  console.log("\n✅  Pipeline completed.");
}

main();
