/**
 * The quota backstop's one exception (spec/30 Phase A, Rule 15.7).
 *
 * Extracted so the interrupt-requests route and its tests share ONE
 * implementation. The bug this rule fixed — the backstop refusing an
 * exceptional substitution at zero allowance, which is its precondition —
 * was originally covered by a mirror test asserting a private copy of the
 * logic (spec/31 test-suite audit). A mirror stays green while the route
 * drifts; this cannot.
 */

/**
 * May this request bypass the "no allowance remaining" refusal?
 *
 * Only an exceptional substitution: its whole premise is that the legal
 * allowance is gone (Rule 15.7). The flag on any other request type is
 * meaningless and must not become a universal quota bypass.
 */
export function quotaBypassAllowed(opts: {
  requestType: string;
  isExceptional?: boolean;
}): boolean {
  return opts.requestType === "SUBSTITUTION" && opts.isExceptional === true;
}
