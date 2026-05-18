import exchangesData from '@data/exchanges.json';

export type Exchange = (typeof exchangesData)[number];

export function getExchangeBySlug(slug: string): Exchange | null {
  return exchangesData.find((e) => e.slug === slug) ?? null;
}

export function getAllSlugs(): string[] {
  return exchangesData.map((e) => e.slug);
}

export function taxRegimeLabel(r: string, lang = 'pt-BR'): string {
  const isEn = lang === 'en';
  const labels: Record<string, string> = {
    domestic_exchange: isEn ? 'Domestic' : 'Nacional',
    domestic_exchange_foreign_origin: isEn ? 'Domestic (Foreign origin)' : 'Nacional (origem ext.)',
    offshore_law_14754: 'Offshore',
  };
  return labels[r] ?? r ?? '';
}

export function isoFlag(iso: string | null | undefined): string {
  if (!iso) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

export function fmtFee(val: number | null | undefined, lang = 'en'): string | null {
  if (val === null || val === undefined) return null;
  return new Intl.NumberFormat(lang === 'pt-BR' ? 'pt-BR' : 'en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(val);
}
