# Volleyball Scoring Platform — Change Requests & Spec

This document collects feature requests, bug fixes, and open questions for the Volleyball Scoring Platform, plus a full rule-engine specification (Appendix A) for rotation, serving, side changes, and time-outs across the three supported disciplines.

---

## 1. UI / Navigation

1. **Landing page copy** — The initial landing page should say only **"Volleyball Scoring Platform"**. Remove "Multi-discipline, multi-tenant…" and "White Label Scoring SaaS".
2. **Top navigation menu** — Navigation is cumbersome without a top menu. Add one (can reuse the same elements as the main menu).
3. **Light / dark mode toggle** — Add a light/dark mode toggle. Validate that the UI is responsive and fully functional in both modes.
4. **Team colors** — Let scorers select each team's colors before the match and surface that color in the interface. Handle conflicts where the chosen color clashes with the interface (e.g. black on black, dark grey on black) — fall back to a contrasting treatment.

## 2. Bugs

1. **Duplicate jersey numbers** — The system currently allows adding players with the same jersey number. Prevent duplicates within a team.
2. **Tablet requests not received** — Requests from the teams' tablets are not coming through to the scorer view. Fix the request delivery path.

## 3. Data Import

1. **Merge player + team import** — Combine the "Import players" and "Import teams" functions into a **single CSV import**. Provide an example CSV with the first row pre-filled with placeholder data ("John Doe"), which the system ignores for creation unless the user edits it.
2. **Schedule import template** — Create a CSV template for schedule import, with the first example row pre-filled and ignored by the system unless changed. Columns:
   - Match number
   - Team A
   - Team B
   - Court number
   - Group
   - Phase number
   - Phase name
   - Match day
   - Match time (local)

## 4. Scorer & Scoreboard

1. **POINT button follows team side** — On the scorer page, each team's POINT button should switch sides when the teams switch courts, so the button always stays on the same side as its players.
2. **Faster scoreboard updates** — Can the scoreboard refresh/update faster? Reduce latency between scorer input and scoreboard display.
3. **Timeouts on scoreboard** — Show timeouts on the scoreboard as a countdown, displayed on the side of the team that requested it.
4. **Pre-match countdown** — Add a countdown (to a clock time XX:XX, or for a duration HH:MM) that is visible on both the scorer UI and the scoreboard before the match begins.
5. **Scoreboard examples** — (Reference examples to be attached.)

## 5. Architecture — IDs, URLs & Access

1. **Numeric IDs** — Build the whole system around numeric **Competition IDs** and **Match IDs**.
2. **Simple URLs** — Scoreboard, scorer page, and team tablets should each be reachable by a simple URL, e.g.:
   - `…/Tablets/{MatchID}/A`
   - `…/Scorers/{MatchID}`
   - `…/Scoreboard/{MatchID}`
3. **Scorer password** — Require a **6-digit numeric password** for scorers.

## 6. Scope Changes

1. **Remove "Challenge"** — Remove the challenge feature from the app entirely for now.

## 7. Open Questions

1. **Arc fault** — What is "arc fault" meant to be? (Clarify intended behavior / whether it should remain.)

## 8. Rule Engine (Rotation, Serving, Side Changes, Time-outs)

Implement rotation, expected serving player, time-outs, technical time-outs, side/court changes, and players-per-team according to **Appendix A**. Supported disciplines: `indoor_volleyball`, `beach_volleyball`, `air_light_volleyball`.

---

# Appendix A — Volleyball App Rule Engine Guide: Indoor, Beach, Air/Light

## Purpose

This specification defines how the app should handle: rotation, expected serving player, side/court changes, time-outs, technical time-outs, and number of players per team.

Supported disciplines: `["indoor_volleyball", "beach_volleyball", "air_light_volleyball"]`

Indoor and Beach are based on the current FIVB 2025–2028 rule editions. Air/Light is based on the Light Volleyball Competition Rules 2022–2025.

## 1. High-level comparison

| Function | Indoor Volleyball | Beach Volleyball | Air / Light Volleyball |
|---|---|---|---|
| Players on court | 6 per team | 2 per team | 4 or 5 per team, by competition format |
| Rotation | Yes, clockwise on side-out | No positional rotation; only service order alternates | Yes, clockwise on side-out |
| Expected server | Player in position 1, back-right | Correct player in alternating service order | Player in position 1, back-right |
| If serving team wins rally | Same server continues | Same server continues | Next server per Air/Light rule: player moving from position 2 to position 1 serves |
| If receiving team wins rally | Receiving team rotates, position 2 → position 1 and serves | Receiving team gains service; its next player in service order serves | Receiving team rotates clockwise; position 2 → position 1 and serves |
| Positional faults | Yes | No | Yes |
| Side/court change between sets | After each set except before deciding set; deciding set has special change | Court switches during sets; interval between sets | After first set; deciding set changes at 8 |
| Court change during deciding set | At 8 points in set 5 | Every 5 total points in set 3 | At 8 points in set 3 |
| Court switches during normal sets | No | Every 7 total points in sets 1 and 2 | No |
| Regular time-outs | 2 per team per set, 30 s | 1 per team per set, 30 s | 2 per team per set, 30 s |
| Technical time-outs | Not enabled by default; competition-specific | Enabled in FIVB official beach: at total points = 21 in sets 1 and 2 | Not defined in rulebook; competition-specific |
| Team decides number of players? | No | No | No; competition format defines 4- or 5-player |

## 2. Unified app model

```json
{
  "discipline": "indoor_volleyball | beach_volleyball | air_light_volleyball",
  "match_format": {
    "sets_to_win": 2,
    "regular_set_points": 21,
    "deciding_set_points": 15
  },
  "team_format": {
    "players_on_court_per_team": 0,
    "roster_max_players": null,
    "substitutions_allowed": true
  },
  "rotation": {
    "enabled": false,
    "type": null,
    "trigger": null,
    "position_mapping_after_rotation": {}
  },
  "serving": {
    "service_order_required": true,
    "expected_server_rule": "",
    "same_server_continues_if_serving_team_wins": true,
    "service_order_fault_penalty": "point_and_service_to_opponent"
  },
  "court_changes": {
    "between_sets": [],
    "during_sets": []
  },
  "timeouts": {
    "regular_timeouts_per_team_per_set": 0,
    "regular_timeout_duration_seconds": 30,
    "request_window": "ball_out_of_play_before_whistle_for_service"
  },
  "technical_timeouts": {
    "enabled_by_default": false,
    "trigger": null,
    "duration_seconds": null,
    "competition_specific": true
  }
}
```

## 3. Indoor Volleyball configuration

Indoor uses 6 players per team on court, rotational positions, and a fixed service order. The receiving team rotates when it wins the rally and gains the right to serve; the server is the back-right player in position 1.

```json
{
  "discipline": "indoor_volleyball",
  "team_format": {
    "players_on_court_per_team": 6,
    "roster_max_players": 12,
    "substitutions_allowed": true,
    "team_can_choose_players_on_court_count": false
  },
  "positions": {
    "front_row": [2, 3, 4],
    "back_row": [1, 5, 6],
    "server_position": 1
  },
  "rotation": {
    "enabled": true,
    "type": "clockwise",
    "trigger": "receiving_team_wins_rally_and_gains_service",
    "position_mapping_after_rotation": {
      "2": "1", "1": "6", "6": "5", "5": "4", "4": "3", "3": "2"
    }
  },
  "serving": {
    "service_order_required": true,
    "expected_server_rule": "player_currently_in_position_1",
    "if_serving_team_wins_rally": "same_server_serves_again",
    "if_receiving_team_wins_rally": "receiving_team_rotates_clockwise_then_player_in_position_1_serves",
    "service_order_fault_penalty": "point_and_service_to_opponent"
  },
  "court_changes": {
    "between_sets": [
      { "trigger": "after_each_non_deciding_set", "action": "change_courts" }
    ],
    "deciding_set": {
      "set_number": 5,
      "trigger": "leading_team_reaches_8_points",
      "action": "change_courts_without_delay",
      "keep_player_positions_same": true
    }
  },
  "timeouts": {
    "regular_timeouts_per_team_per_set": 2,
    "regular_timeout_duration_seconds": 30,
    "request_window": "ball_out_of_play_before_whistle_for_service"
  },
  "technical_timeouts": {
    "enabled_by_default": false,
    "competition_specific": true,
    "note": "Do not auto-trigger technical time-outs unless competition regulations configure them."
  }
}
```

**Indoor implementation rules**

```
on_rally_end(winning_team):
  award_point(winning_team)
  if winning_team == current_serving_team:
    expected_server = current_server
  else:
    current_serving_team = winning_team
    rotate_clockwise(winning_team)
    expected_server = player_at_position_1(winning_team)
```

## 4. Beach Volleyball configuration

Beach has 2 players per team and no positional rotation. Players may stand freely, but the service order must be maintained.

```json
{
  "discipline": "beach_volleyball",
  "team_format": {
    "players_on_court_per_team": 2,
    "roster_max_players": 2,
    "substitutions_allowed": false,
    "team_can_choose_players_on_court_count": false
  },
  "positions": {
    "front_row": [],
    "back_row": [],
    "server_position": null,
    "positional_faults_enabled": false
  },
  "rotation": {
    "enabled": false,
    "type": null,
    "trigger": null,
    "note": "No fixed court-position rotation. Only service order alternates."
  },
  "serving": {
    "service_order_required": true,
    "expected_server_rule": "next_player_in_team_service_order",
    "if_serving_team_wins_rally": "same_server_serves_again",
    "if_receiving_team_wins_rally": "receiving_team_gains_service_and_next_player_in_service_order_serves",
    "service_order_fault_penalty": "point_and_service_to_opponent"
  },
  "court_changes": {
    "sets_1_and_2": {
      "trigger": "total_points_multiple_of_7",
      "action": "switch_courts_without_delay"
    },
    "deciding_set": {
      "set_number": 3,
      "trigger": "total_points_multiple_of_5",
      "action": "switch_courts_without_delay"
    },
    "if_missed": {
      "action": "switch_as_soon_as_error_is_noticed",
      "score_change": false
    }
  },
  "timeouts": {
    "regular_timeouts_per_team_per_set": 1,
    "regular_timeout_duration_seconds": 30,
    "requester": "captain",
    "request_window": "ball_out_of_play_before_whistle_for_service"
  },
  "technical_timeouts": {
    "enabled_by_default": true,
    "applies_to": "fivb_world_and_official_competitions",
    "sets": [1, 2],
    "trigger": "team_a_score + team_b_score == 21",
    "duration_seconds": 30,
    "set_3_enabled": false
  }
}
```

**Beach implementation rules**

```
on_rally_end(winning_team):
  award_point(winning_team)
  if winning_team == current_serving_team:
    expected_server = current_server
  else:
    current_serving_team = winning_team
    expected_server = next_player_in_service_order(winning_team)

on_score_change_beach(set_number):
  total_points = team_a_score + team_b_score
  if set_number in [1, 2] and total_points > 0 and total_points % 7 == 0:
    trigger_court_switch()
  if set_number == 3 and total_points > 0 and total_points % 5 == 0:
    trigger_court_switch()
  if set_number in [1, 2] and total_points == 21 and technical_timeout_not_used:
    trigger_technical_timeout(duration=30)
```

## 5. Air / Light Volleyball configuration

The rulebook supports four-player and five-player formats, with the starting line-up defining rotational order. Four-player uses positions 1–4; five-player uses positions 1–5. The receiving team rotates one position clockwise when it gains the right to serve, and the player in position 2 rotates to position 1 to serve.

```json
{
  "discipline": "air_light_volleyball",
  "team_format": {
    "players_on_court_per_team": "4_or_5_by_competition_format",
    "allowed_players_on_court_values": [4, 5],
    "roster_max_players": 10,
    "substitutions_allowed": true,
    "team_can_choose_players_on_court_count": false,
    "competition_must_define_format": true
  },
  "positions_4_player": {
    "front_row": [2, 3],
    "back_row": [1, 4],
    "server_position": 1
  },
  "positions_5_player": {
    "front_row": [2, 3, 4],
    "back_row": [1, 5],
    "server_position": 1
  },
  "rotation": {
    "enabled": true,
    "type": "clockwise",
    "trigger": "receiving_team_wins_rally_and_gains_service",
    "position_mapping_after_rotation_4_player": {
      "2": "1", "1": "4", "4": "3", "3": "2"
    },
    "position_mapping_after_rotation_5_player": {
      "2": "1", "1": "5", "5": "4", "4": "3", "3": "2"
    }
  },
  "serving": {
    "service_order_required": true,
    "expected_server_rule": "player_currently_in_position_1_back_right",
    "if_receiving_team_wins_rally": "receiving_team_rotates_clockwise_then_player_moving_from_position_2_to_position_1_serves",
    "service_order_fault_penalty": "point_and_service_to_opponent",
    "service_execution_time_seconds": 8
  },
  "court_changes": {
    "between_sets": [
      { "trigger": "after_set_1", "action": "change_courts" }
    ],
    "deciding_set": {
      "set_number": 3,
      "trigger": "leading_team_reaches_8_points",
      "action": "change_courts_without_delay",
      "keep_player_positions_same": true,
      "if_missed": "change_as_soon_as_error_is_noticed_score_unchanged"
    }
  },
  "timeouts": {
    "regular_timeouts_per_team_per_set": 2,
    "regular_timeout_duration_seconds": 30,
    "requester": "coach_or_game_captain_if_no_coach",
    "request_window": "ball_out_of_play_before_whistle_for_service"
  },
  "technical_timeouts": {
    "enabled_by_default": false,
    "competition_specific": true,
    "note": "No automatic technical time-out is defined in the uploaded Air/Light rulebook."
  }
}
```

Air/Light regular time-outs are two per team per set, lasting 30 seconds, requested when the ball is out of play and before the whistle for service. Court changes occur after the first set and, in the deciding set, when the leading team reaches 8 points.

## 6. Unified decision logic

**A. Determine expected server**

```
function get_expected_server(match, team):
  if match.discipline == "indoor_volleyball":
    return team.player_at_position[1]
  if match.discipline == "air_light_volleyball":
    return team.player_at_position[1]
  if match.discipline == "beach_volleyball":
    return team.next_server_in_service_order
```

**B. After each rally**

```
function on_rally_end(match, winning_team):
  losing_team = other_team(winning_team)
  award_point(winning_team)
  if winning_team == match.current_serving_team:
    if match.discipline == "indoor_volleyball":
      match.expected_server = match.current_server
    if match.discipline == "beach_volleyball":
      match.expected_server = match.current_server
    if match.discipline == "air_light_volleyball":
      match.expected_server = determine_air_light_server_after_serving_team_wins(winning_team)
  else:
    match.current_serving_team = winning_team
    if match.discipline == "indoor_volleyball":
      rotate_clockwise(winning_team)
      match.expected_server = winning_team.player_at_position[1]
    if match.discipline == "beach_volleyball":
      advance_service_order(winning_team)
      match.expected_server = winning_team.next_server_in_service_order
    if match.discipline == "air_light_volleyball":
      rotate_clockwise(winning_team)
      match.expected_server = winning_team.player_at_position[1]
```

For Indoor, if the serving team wins, the same player continues serving. For Air/Light, the rule text says that after the first service, when the serving team wins the rally the player who served rotates and the player moving from front-right position 2 to back-right position 1 serves — so implement that literal Air/Light rule, or keep it configurable if the competition wants standard "same server continues" behaviour.

## 7. Court-change engine

```
function check_court_change(match):
  total_points = match.team_a_score + match.team_b_score
  if match.discipline == "indoor_volleyball":
    if match.current_set == 5 and leading_team_score() == 8 and not match.court_change_done:
      change_courts()
      keep_player_positions_same()
  if match.discipline == "beach_volleyball":
    if match.current_set in [1, 2] and total_points > 0 and total_points % 7 == 0:
      change_courts()
    if match.current_set == 3 and total_points > 0 and total_points % 5 == 0:
      change_courts()
  if match.discipline == "air_light_volleyball":
    if match.current_set == 3 and leading_team_score() == 8 and not match.court_change_done:
      change_courts()
      keep_player_positions_same()
```

## 8. Time-out engine

```
function can_request_timeout(match, team, requester):
  if ball_is_in_play:
    return false
  if whistle_for_service_already_given:
    return false
  max_timeouts = get_timeout_limit(match.discipline)
  if team.timeouts_used_this_set >= max_timeouts:
    return false
  if match.discipline == "beach_volleyball" and requester != "captain":
    return false
  return true

function get_timeout_limit(discipline):
  if discipline == "indoor_volleyball":
    return 2
  if discipline == "beach_volleyball":
    return 1
  if discipline == "air_light_volleyball":
    return 2
```

## 9. Technical time-out engine

```
function check_technical_timeout(match):
  total_points = match.team_a_score + match.team_b_score
  if match.discipline == "beach_volleyball":
    if match.current_set in [1, 2] and total_points == 21 and not match.technical_timeout_used_this_set:
      trigger_technical_timeout(duration_seconds = 30)
  if match.discipline == "indoor_volleyball":
    if match.competition_config.technical_timeouts.enabled:
      evaluate_competition_specific_tto_rule()
  if match.discipline == "air_light_volleyball":
    if match.competition_config.technical_timeouts.enabled:
      evaluate_competition_specific_tto_rule()
```

Recommended default:

```json
{
  "technical_timeouts_default": {
    "indoor_volleyball": false,
    "beach_volleyball": true,
    "air_light_volleyball": false
  }
}
```

## 10. Compact LLM prompt summary

You are configuring a volleyball scoring/rules app. The app supports three disciplines: `indoor_volleyball`, `beach_volleyball`, and `air_light_volleyball`.

**indoor_volleyball**
- 6 players per team on court. Rotation enabled. Positions 1–6. Position 1 is the server (back-right). Front row: 2, 3, 4. Back row: 1, 5, 6.
- When the receiving team wins a rally, it scores, gains service, rotates clockwise, and the player moving from position 2 to position 1 serves. When the serving team wins, the same server continues.
- Positional and rotation faults enabled. 2 requested time-outs per set (30 s each). Technical time-outs disabled by default; enable only via competition config.
- Change courts after non-deciding sets. In the deciding 5th set, change courts when the leading team reaches 8 points; positions remain the same.

**beach_volleyball**
- 2 players per team. No substitutions. No fixed positional rotation and no positional faults. Service order required.
- When the serving team wins, the same player continues serving. When the receiving team wins, it scores, gains service, and the next player in its service order serves.
- 1 requested time-out per set (30 s). Technical time-out enabled by default for FIVB/official beach competitions in sets 1 and 2 when total points equal 21; none in set 3.
- Switch courts every 7 total points in sets 1 and 2, and every 5 total points in set 3. If missed, switch as soon as noticed; score unchanged.

**air_light_volleyball**
- Competition format must define 4-player or 5-player; teams cannot independently choose unless regulations allow it. Roster max 10 players. Rotation enabled. Position 1 is the server (back-right).
- 4-player: front row 2, 3; back row 1, 4. 5-player: front row 2, 3, 4; back row 1, 5.
- The receiving team rotates clockwise when it wins a rally and gains service; the player moving from position 2 to position 1 serves. Positional and rotation faults enabled.
- 2 requested time-outs per set (30 s each). Technical time-outs disabled by default; enable only via competition config.
- Change courts after the first set. In the deciding 3rd set, change courts when the leading team reaches 8 points; positions remain the same.
