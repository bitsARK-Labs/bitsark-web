// src/i18n/ui.ts
import en from './en.json';
import pt from './pt.json';

export const ui = {
  'en':    en,
  'pt-BR': pt,
} as const;

export type Lang = keyof typeof ui;

export function useTranslations(lang: string) {
  // Aceita 'pt', 'pt-BR', 'pt-br' - normaliza tudo para 'pt-BR'
  const key = lang.startsWith('pt') ? 'pt-BR' : 'en';
  return ui[key];
}