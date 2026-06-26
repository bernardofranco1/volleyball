"use client";

import { useFormStatus } from "react-dom";
import { ui } from "@/components/admin/styles";

/**
 * A submit button that reflects the enclosing <form>'s pending state. Works in
 * both server-action forms and useActionState forms (reads form status from the
 * nearest <form> via React DOM).
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    variant === "secondary"
      ? ui.btnSecondary
      : variant === "danger"
        ? ui.btnDanger
        : ui.btnPrimary;
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${base} ${className ?? ""}`}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
