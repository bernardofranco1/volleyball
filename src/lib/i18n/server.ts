// Server-side locale resolution (reads the `locale` cookie). Node-runtime only.
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  MESSAGES,
  type Locale,
  isLocale,
  translate,
} from "./messages";

export const LOCALE_COOKIE = "locale";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return v && isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Locale + a bound `t()` for Server Components, plus the merged client dict. */
export async function getT(): Promise<{
  locale: Locale;
  t: (key: string) => string;
  messages: Record<string, string>;
}> {
  const locale = await getLocale();
  return {
    locale,
    t: (key: string) => translate(locale, key),
    // English ∪ locale so the client hook has a fallback baked in.
    messages: { ...MESSAGES.en, ...MESSAGES[locale] },
  };
}
