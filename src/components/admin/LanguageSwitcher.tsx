"use client";

import { useTransition } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/messages";
import { ui } from "@/components/admin/styles";

export function LanguageSwitcher({ current }: { current: Locale }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Language"
      defaultValue={current}
      disabled={pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("locale", e.target.value);
        start(() => setLocale(fd));
      }}
      className={`${ui.select} w-44`}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
