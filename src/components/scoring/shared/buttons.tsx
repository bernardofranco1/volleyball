"use client";

// Presentational atoms shared by the four discipline action bars.
import { readableTextOn } from "@/lib/colors";
import { useT } from "@/lib/i18n/client";

export function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-24 place-items-center rounded-xl border border-border bg-surface-raised p-4 text-center text-lg font-medium">
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ScoreButton({
  children,
  onClick,
  armed,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  armed: boolean;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: color, color: readableTextOn(color) }}
      className={`rounded-xl px-4 py-4 text-base font-semibold transition-all ${
        armed
          ? "animate-pulse ring-4 ring-white/80"
          : "ring-1 ring-black/10 hover:brightness-110"
      }`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  armed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  armed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
        armed
          ? "border-red-500 bg-red-500/10 text-red-300"
          : "border-border text-score-dim hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function SelectRow({
  label,
  value,
  onChange,
  options,
  optionLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  optionLabel: (id: string) => string;
}) {
  const t = useT();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-10 text-score-dim">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
      >
        {options.length === 0 ? <option value="">{t("scoring.none")}</option> : null}
        {options.map((id) => (
          <option key={id} value={id}>
            {optionLabel(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PanelConfirm({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
