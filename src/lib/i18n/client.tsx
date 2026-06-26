"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from "./messages";

interface LocaleCtx {
  locale: Locale;
  messages: Record<string, string>;
}

const Ctx = createContext<LocaleCtx>({ locale: DEFAULT_LOCALE, messages: {} });

export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Record<string, string>;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ locale, messages }}>{children}</Ctx.Provider>;
}

/** Client translation hook. Returns `t(key)` → message or the key as fallback. */
export function useT(): (key: string) => string {
  const { messages } = useContext(Ctx);
  return (key: string) => messages[key] ?? key;
}

export function useLocale(): Locale {
  return useContext(Ctx).locale;
}
