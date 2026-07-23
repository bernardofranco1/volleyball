"use client";

// Keyboard-shortcut runtime for the scorer console. One window listener per
// console (ShortcutProvider); components declare "what's on screen is
// bindable" by registering handlers — the action bars for the live grid, the
// phase banners for their primary action — so a key only ever fires something
// the scorer can also see and tap. Unbound or momentarily-invalid actions are
// simply not registered.
//
// Guards: keystrokes while typing (inputs/textareas/contentEditable), while
// any dialog is open, with Ctrl/Alt/Meta held, or auto-repeating are ignored.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Keymap,
  SHORTCUT_ACTION_IDS,
  type ShortcutActionId,
  keymapConflicts,
  loadKeymap,
  normalizeKey,
  resetKeymap,
  saveKeymap,
} from "@/lib/shortcuts";
import { useT } from "@/lib/i18n/client";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";

interface ShortcutCtx {
  register: (id: ShortcutActionId, run: () => void) => () => void;
  openSettings: () => void;
}

const Ctx = createContext<ShortcutCtx | null>(null);

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
}

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Map<ShortcutActionId, () => void>());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The settings modal captures raw keydowns while rebinding; the global
  // listener stands down whenever any dialog is open (its own included).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const key = normalizeKey(e.key);
      const map = loadKeymap(); // read fresh — settings changes apply instantly
      const id = SHORTCUT_ACTION_IDS.find((a) => map[a] === key);
      if (!id) return;
      if (id === "help") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      const run = handlers.current.get(id);
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const register = useCallback((id: ShortcutActionId, run: () => void) => {
    handlers.current.set(id, run);
    return () => {
      if (handlers.current.get(id) === run) handlers.current.delete(id);
    };
  }, []);

  const value = useMemo<ShortcutCtx>(
    () => ({ register, openSettings: () => setSettingsOpen(true) }),
    [register],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {settingsOpen ? (
        <ShortcutSettingsModal onClose={() => setSettingsOpen(false)} />
      ) : null}
    </Ctx.Provider>
  );
}

/**
 * Bind a shortcut action to a handler while mounted. Pass `null` while the
 * action isn't valid (e.g. grid actions while a phase banner is showing).
 * Safe without a provider (no-op) — bars also render on tablet routes.
 */
export function useShortcut(
  id: ShortcutActionId,
  handler: (() => void) | null,
): void {
  const ctx = useContext(Ctx);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const active = handler != null && ctx != null;
  const register = ctx?.register;
  useEffect(() => {
    if (!active || !register) return;
    return register(id, () => ref.current?.());
  }, [id, active, register]);
}

/** Declarative binding for use inside conditional JSX (phase banners). */
export function ShortcutAction({
  id,
  run,
}: {
  id: ShortcutActionId;
  run: () => void;
}) {
  useShortcut(id, run);
  return null;
}

/** Header-tools trigger for the shortcut settings (also opened with `?`). */
export function ShortcutSettingsButton() {
  const t = useT();
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.openSettings}
      className="rounded border border-border px-2 py-0.5 text-[11px] text-score-dim transition-colors hover:text-foreground"
      title={t("shortcut.open")}
    >
      ⌨
    </button>
  );
}

// ── settings ─────────────────────────────────────────────────────────────────

const KEY_LABEL: Record<string, string> = { space: "␣ space", enter: "↵ enter" };

function ShortcutSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [map, setMap] = useState<Keymap>(() => loadKeymap());
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const conflicts = keymapConflicts(map);

  // While rebinding, the next keydown becomes the binding (Esc cancels).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return; // plain keys only
      const next = { ...map, [capturing]: normalizeKey(e.key) };
      setMap(next);
      saveKeymap(next);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing, map]);

  return (
    <ScoringModal title={t("shortcut.title")} onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        {SHORTCUT_ACTION_IDS.map((id) => {
          const key = map[id];
          const conflicted = conflicts.has(key);
          return (
            <div key={id} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t(`shortcut.${id}`)}</span>
              <button
                type="button"
                onClick={() => setCapturing(capturing === id ? null : id)}
                className={`min-w-[5.5rem] rounded-lg border px-2 py-1 text-center font-mono text-xs transition-colors ${
                  capturing === id
                    ? "border-primary text-foreground"
                    : conflicted
                      ? "border-red-500/60 text-red-400"
                      : "border-border text-score-dim hover:text-foreground"
                }`}
              >
                {capturing === id ? t("shortcut.pressKey") : (KEY_LABEL[key] ?? key)}
              </button>
            </div>
          );
        })}
        {conflicts.size > 0 ? (
          <p className="text-xs text-red-400">{t("shortcut.conflict")}</p>
        ) : null}
        <p className="text-xs text-score-dim">{t("shortcut.hint")}</p>
        <SecondaryButton
          onClick={() => {
            setMap(resetKeymap());
            setCapturing(null);
          }}
        >
          {t("shortcut.reset")}
        </SecondaryButton>
      </div>
    </ScoringModal>
  );
}
