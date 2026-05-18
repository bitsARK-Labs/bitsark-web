// src/i18n/index.ts
import en from './en.json';
import pt from './pt.json';

export const defaultLang = 'en' as const;

export const ui = {
  'en':    en,
  'pt-BR': pt,
} as const;

export type Lang = keyof typeof ui;

/** Estrutura do dicionário (deriva do en.json - fonte da verdade). */
export type Dict = typeof en;

/**
 * Gera união de strings com paths dot-notation a partir de um objeto recursivo.
 * Limita a 8 níveis de profundidade para evitar explosão de tipos.
 * @example DotPath<{a: {b: string}}> = 'a' | 'a.b'
 */
type Primitive = string | number | boolean | null;
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8];
export type DotPath<T, Depth extends number = 8> =
  [Depth] extends [never] ? never :
  T extends Primitive ? never :
  T extends ReadonlyArray<unknown> ? never :
  {
    [K in keyof T & string]:
      T[K] extends Primitive
        ? K
        : T[K] extends ReadonlyArray<unknown>
          ? K
          : K | `${K}.${DotPath<T[K], Prev[Depth]>}`
  }[keyof T & string];

/** Resolve o tipo de valor em um path dot-notation. */
export type PathValue<T, P extends string> =
  P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? PathValue<T[K], Rest>
      : unknown
    : P extends keyof T
      ? T[P]
      : unknown;

export type TranslationKey = DotPath<Dict>;

/** Detecta idioma pela URL: /pt/... → 'pt-BR', qualquer outra → 'en' */
export function getLangFromUrl(url: URL): Lang {
  const [, seg] = url.pathname.split('/');
  return seg === 'pt' ? 'pt-BR' : defaultLang;
}

/**
 * Localiza um link interno.
 */
export function useLocalizedPath(lang: Lang) {
  return function l(path: string): string {
    const prefix = lang.startsWith('pt') ? '/pt' : '';
    return `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
  };
}

/**
 * Hook para componentes Astro com tipagem de chaves.
 * `t<K>(key: K)` infere o tipo do valor a partir do en.json.
 * Chaves inexistentes são erro de compilação.
 *
 * @example
 * const t = useTranslations(getLangFromUrl(Astro.url));
 * t('nav.home.dolarmap')   // tipo: string
 * t('hero.stats')          // tipo: array (PathValue resolve)
 * t('foo.bar')             // ❌ erro: chave não existe
 */
export function useTranslations(lang: Lang) {
  const key = lang.startsWith('pt') ? 'pt-BR' : 'en';
  const dict = ui[key as Lang] || ui[defaultLang];
  return function t<K extends TranslationKey>(key: K): PathValue<Dict, K> {
    const value = key.split('.').reduce<unknown>(
      (obj, k) => (obj && typeof obj === 'object'
        ? (obj as Record<string, unknown>)[k]
        : undefined),
      dict
    );
    if (value === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing key: "${key}" for language: "${lang}"`);
      }
      return key as unknown as PathValue<Dict, K>;
    }
    return value as PathValue<Dict, K>;
  };
}

// Re-exporta o objeto bruto para os locais que acessam por dot (t.foo.bar).
export { ui as translations };