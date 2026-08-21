/**
 * VolleyStation payload types (spec/45 §2/§3).
 *
 * Transcribed from real responses measured on 2026-08-20. Only the fields the
 * boards read are typed; everything else the API sends is left off rather than
 * guessed at, so a field appearing here means it was observed.
 */

/**
 * The scoreboard state VolleyStation maintains per match.
 *
 * The important one is `lineup_home`/`lineup_guest`: six SHIRT numbers in
 * POSITION ORDER, position 1 first — verified because `serving_player_number`
 * equals `lineup[0]` of the serving side on every populated widget observed.
 * That is the scorer's live rotation, which is why a VS-sourced board derives
 * nothing (contrast spec/42 and spec/43, which exist entirely to reconstruct
 * this from the VIS rally stream).
 *
 * The six are the ROTATION, not who is physically on court: `libero_replacing_*`
 * names whichever of them is currently off, and `libero_number_*` the libero in
 * their place. VIS does that swap for us; here we do it ourselves.
 */
export interface VsWidget {
  current_set: number | null;
  /** Rally index WITHIN the current set; null before the first rally. */
  current_rally: number | null;
  current_set_points_home: number | null;
  current_set_points_away: number | null;
  won_sets_home: number | null;
  won_sets_away: number | null;
  lineup_home: (number | null)[] | null;
  lineup_guest: (number | null)[] | null;
  libero_replacing_home: number | null;
  libero_number_home: number | null;
  libero_replacing_guest: number | null;
  libero_number_guest: number | null;
  left_side: "home" | "away" | null;
  serve: "home" | "away" | null;
  serving_player_number: number | null;
  in_rally: boolean | null;
  in_set: boolean | null;
  /** Element shape unobserved — read `.length` only, never index into it. */
  current_substitutions: { home: unknown[]; away: unknown[] } | null;
}

export interface VsMatch {
  ChampionshipMatch_ID: number;
  Championship_ID: number;
  /** The join key to VIS `NoInTournament`. A STRING in this API. */
  MatchNumber: string | null;
  HomeTeam: string | null;
  GuestTeam: string | null;
  HomeTeam_ID: number | null;
  GuestTeam_ID: number | null;
  /** ISO with the PANEL's offset (+02:00) — not the venue's. Instants only. */
  MatchDateTime: string | null;
  WonSetHome: number | null;
  WonSetGuest: number | null;
  Set1Home: number | null; Set1Guest: number | null;
  Set2Home: number | null; Set2Guest: number | null;
  Set3Home: number | null; Set3Guest: number | null;
  Set4Home: number | null; Set4Guest: number | null;
  Set5Home: number | null; Set5Guest: number | null;
  /** `[home, guest]` REMAINING — not used. See spec/45 §3 finding 5. */
  timeout_count: number[] | null;
  substitution_count: number[] | null;
  challenge_count: number[] | null;
  /**
   * The challenge IN FLIGHT, when there is one (spec/48 W5). This is the field
   * the TV overlay wants: a snapshot of the present, not a counter delta, so it
   * says "a challenge is happening now" in a way `challenge_count` cannot.
   * Populated example committed as fixture match 2504866.
   *
   * `"home"`/`"away"`, and null the rest of the time — including for a challenge
   * that has just been decided, which is why the counters remain the outcome
   * fallback.
   */
  challenge_team: "home" | "away" | null;
  /**
   * Why it was called, in VolleyStation's own vocabulary — `"netTouch"` is the
   * one observed. Mapped to a card label by `categoryFor` (director.ts); an
   * unknown reason auto-fills nothing rather than guessing.
   */
  challenge_reason: string | null;
  /** ISO, panel offset — like `MatchDateTime`, an instant and nothing more. */
  challenge_time: string | null;
  /**
   * OPAQUE. The vocabulary is unobserved (spec/48 §3: a capture is running to
   * pin it), so nothing switches on this and nothing may until it is measured.
   */
  challenge_phase: string | null;
  /**
   * `{ home: [], away: [] }` on some rows and null on others; element shape
   * unobserved. Typed so the field is not silently dropped, never read.
   */
  challenge_bookmarks: { home?: unknown[]; away?: unknown[] } | null;
  HomeDisqualification: boolean | null;
  GuestDisqualification: boolean | null;
  postponed: boolean | null;
  Spectators: number | null;
  widget: VsWidget | null;
}

export interface VsPlayerEntry {
  Player_ID: number;
  Player_Surname: string | null;
  Player_Name: string | null;
  Player_ShirtName: string | null;
  /** Shirt number — the key the widget's line-ups speak in. */
  Number: number | null;
  Position: number | null;
  /** The VIS `NoPlayer`, as a string. */
  code: string | null;
}

export interface VsTeam {
  Team_ID: number;
  /** The VIS `NoTeam`, as a string. */
  Code: string | null;
  /** The VIS three-letter team code, e.g. "TPE". */
  ShortCodeName: string | null;
  Name: string | null;
  PlayerList: VsPlayerEntry[] | null;
}

/** Per-player, per-match aggregates. NB: `Points` is only HALF the total. */
export interface VsStatsRow {
  PlayerID: number;
  Number: string | null;
  Libero: number | null;
  is_home: boolean;
  /**
   * Points won while this player's team was SERVING — the break points only.
   * A player's match total is `Points + SideOut`; see `pointsBySide`.
   */
  Points: string | null;
  /** Points won in side-out. The other half of the total. */
  SideOut: string | null;
  SpikeWin: string | null;
  BlockWin: string | null;
  ServeWin: string | null;
}

/** The regulation config the board counts allowances down from. */
export interface VsChampionship {
  Championship_ID: number;
  Name: string | null;
  sets_to_win: number | null;
  points_to_win_set: number | null;
  points_to_win_set_deciding: number | null;
  timeout_limit: number | null;
  /** 8 on the observed FIVB events — NOT the FIVB indoor 6. Read, don't assume. */
  substitutions_limit: number | null;
  video_challenge_limit: number | null;
  libero_can_serve: boolean | null;
}
