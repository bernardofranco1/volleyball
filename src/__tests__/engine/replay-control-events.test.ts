import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import { replayEvents as beachReplay } from "@/engine/beach/reducer";
import { validateBeachEvent } from "@/engine/beach/validator";
import {
  type BeachEvent,
  type BeachEventPayload,
} from "@/engine/beach/types";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const TS = "2026-07-13T10:00:00.000Z";

// ── Regression: control events must advance lastSequence to the LOG head ─────
//
// createReplayFn resolves UNDO/REWIND without reducing them, so the fold over
// the surviving events used to leave lastSequence at the last *surviving*
// event. Persisting that as snapshot_sequence made the next snapshot+tail load
// re-apply the undone events (the discipline reducers treat UNDO as a no-op),
// resurrecting undone points on refresh — and handed out already-used sequence
// numbers to the next append. Found live: an undone TIMEOUT_REQUEST came back
// as timeoutsUsedA=1 on the next /state load.

function buildLog(): { events: BeachEvent[]; ids: Map<string, string> } {
  const events: BeachEvent[] = [];
  const ids = new Map<string, string>();
  let seq = 0;
  const add = (payload: BeachEventPayload, tag?: string) => {
    seq += 1;
    const id = `e${seq}`;
    events.push({ id, sequence: seq, timestamp: TS, payload });
    if (tag) ids.set(tag, id);
  };
  add({ type: "MATCH_CREATED", matchId: "m1" });
  add({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  add({ type: "MATCH_START" });
  add({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
  add({ type: "RALLY_WON_A" });
  add({ type: "TIMEOUT_REQUEST", team: "A" }, "toReq");
  add({ type: "TIMEOUT_END", team: "A" }, "toEnd");
  return { events, ids };
}

describe("replay: UNDO advances lastSequence to the log head", () => {
  it("undoing a timeout pair restores counts AND marks the head sequence", () => {
    const { events, ids } = buildLog();
    // Two undos, exactly as undoLastEvent appends them (latest scorer event first).
    const log: BeachEvent[] = [
      ...events,
      { id: "e8", sequence: 8, timestamp: TS, payload: { type: "UNDO", targetEventId: ids.get("toEnd")! } },
      { id: "e9", sequence: 9, timestamp: TS, payload: { type: "UNDO", targetEventId: ids.get("toReq")! } },
    ];
    const state = beachReplay("m1", log, BEACH);

    // The undone timeout is fully reverted…
    const set = state.sets[state.currentSetNumber - 1];
    expect(set.timeoutsUsedA).toBe(0);
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES");
    // …and lastSequence marks the LOG head (9), not the last surviving event
    // (5). snapshot_sequence = 9 ⇒ empty tail on the next load (no
    // resurrection) and the next append allocates sequence 10 (no collision).
    expect(state.lastSequence).toBe(9);
  });

  it("REWIND also advances lastSequence to the log head", () => {
    const { events } = buildLog();
    const log: BeachEvent[] = [
      ...events,
      // Erase everything after the first rally (sequence 5).
      { id: "e8", sequence: 8, timestamp: TS, payload: { type: "REWIND", toSequence: 5 } as unknown as BeachEventPayload },
    ];
    const state = beachReplay("m1", log, BEACH);
    const set = state.sets[state.currentSetNumber - 1];
    expect(set.timeoutsUsedA).toBe(0); // timeout erased
    expect(state.lastSequence).toBe(8); // head, not 5
  });
});

describe("validator: SET_START beyond bestOf is rejected", () => {
  it("rejects a phantom set after the deciding set (rewind edge)", () => {
    // Rewind can erase MATCH_END and leave the final set in SET_BREAK; an
    // auto-advance must not fabricate set bestOf+1.
    const { events } = buildLog();
    const log: BeachEvent[] = [
      ...events,
      { id: "e8", sequence: 8, timestamp: TS, payload: { type: "SET_END", winner: "A", scoreA: 21, scoreB: 15, setNumber: 1 } },
    ];
    const state = beachReplay("m1", log, BEACH);
    const res = validateBeachEvent(
      { type: "SET_START", setNumber: BEACH.bestOf + 1, firstServer: "B", teamAStartSide: "RIGHT" },
      state,
      BEACH,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/deciding set/);
    // …while the legitimate next set is still allowed.
    const ok = validateBeachEvent(
      { type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" },
      state,
      BEACH,
    );
    expect(ok.ok).toBe(true);
  });
});

describe("reducer: timeout / set-break countdown timestamps", () => {
  it("stamps activeTimeoutStartedAt on TIMEOUT_REQUEST and clears it on TIMEOUT_END", () => {
    const { events } = buildLog();
    const untilRequest = events.slice(0, 6); // …including TIMEOUT_REQUEST
    const during = beachReplay("m1", untilRequest, BEACH);
    expect(during.rallyPhase).toBe("TIMEOUT_ACTIVE");
    expect(during.activeTimeoutStartedAt).toBe(TS); // event timestamp, not wall clock

    const after = beachReplay("m1", events, BEACH); // …including TIMEOUT_END
    expect(after.rallyPhase).toBe("BETWEEN_RALLIES");
    expect(after.activeTimeoutStartedAt).toBeNull();
  });

  it("stamps setBreakStartedAt when a set ends", () => {
    const { events } = buildLog();
    const log: BeachEvent[] = [
      ...events,
      { id: "e8", sequence: 8, timestamp: TS, payload: { type: "SET_END", winner: "A", scoreA: 21, scoreB: 15, setNumber: 1 } },
    ];
    const state = beachReplay("m1", log, BEACH);
    expect(state.rallyPhase).toBe("SET_BREAK");
    expect(state.setBreakStartedAt).toBe(TS);
  });
});
