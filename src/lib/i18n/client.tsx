"use client";

import { createContext, useContext } from "react";
import {
  DEFAULT_LOCALE,
  MESSAGES,
  interpolate,
  type Locale,
  type MsgParams,
} from "./messages";

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

/**
 * Client translation hook. Returns `t(key, params?)` → message or the key as
 * fallback. Falls back to the default-locale catalogue when rendered outside a
 * LocaleProvider (e.g. a scoring tree mounted without the tenant layout).
 */
export function useT(): (key: string, params?: MsgParams) => string {
  const { messages } = useContext(Ctx);
  return (key: string, params?: MsgParams) =>
    interpolate(messages[key] ?? MESSAGES.en[key] ?? key, params);
}

export function useLocale(): Locale {
  return useContext(Ctx).locale;
}
