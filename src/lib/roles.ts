import type { Role } from "@/lib/authz";

// Client-safe role metadata (no DB imports) shared by the access UI. Type-only
// import of Role is erased at build, so this is safe in Client Components.

export const ROLE_LABEL: Record<Role, string> = {
  TENANT_ADMIN: "Admin",
  COMPETITION_ADMIN: "Manager",
  SCORER: "Scorer",
  VIEWER: "Viewer",
};

export const ROLE_HINT: Record<Role, string> = {
  TENANT_ADMIN: "Full control, incl. managing access",
  COMPETITION_ADMIN: "Manage competitions, matches, teams & players",
  SCORER: "Score matches — also needs each match's PIN",
  VIEWER: "Read-only — competitions, matches & standings",
};

// Order shown in pickers (least → most privilege, admin last).
export const ASSIGNABLE_ROLES: Role[] = [
  "VIEWER",
  "SCORER",
  "COMPETITION_ADMIN",
  "TENANT_ADMIN",
];

export interface AddMemberState {
  error: string | null;
  created?: { email: string; tempPassword: string | null; note: string };
}
export const ADD_MEMBER_INIT: AddMemberState = { error: null };
