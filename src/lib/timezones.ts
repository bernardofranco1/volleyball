/**
 * Venue time zones (spec/29 F5).
 *
 * A short, ordinary list for the competition form's datalist — NOT a
 * validation whitelist. The column takes any IANA zone, the renderer falls
 * back to UTC when it cannot resolve one, and a federation running a match
 * somewhere unusual must not be blocked by our list being short.
 *
 * `Intl.supportedValuesOf("timeZone")` would give the full set, but it is a
 * few hundred entries and the point here is to make the common cases one
 * keystroke away.
 */
export const TIMEZONE_SUGGESTIONS = [
  "UTC",
  "Europe/Zurich",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Doha",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
] as const;
