"use server";

import { cookies } from "next/headers";
import { isLocale } from "./messages";
import { LOCALE_COOKIE } from "./server";

/** Persist the chosen locale. Setting a cookie in an action re-renders the page. */
export async function setLocale(formData: FormData): Promise<void> {
  const value = String(formData.get("locale") ?? "");
  if (!isLocale(value)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
