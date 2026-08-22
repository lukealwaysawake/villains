import { applyAction, createFreshPlayers, startHand } from "./game";
import { chipsToBb } from "./types";
import { decideVillain } from "../villains/policy";
import { VILLAINS } from "../villains/catalog";
import { createRuntime } from "../villains/types";

export interface SimRow {
  id: string;
  name: string;
  hands: number;
  bb100: number;
}

function playHand(ids: string[], button: number, seed: string, handNumber: number) {
  const players = createFreshPlayers(ids);
  let state = startHand({ players, button, handNumber, seed });
  const runtimes = Object.fromEntries(ids.filter((id) => id !== "hero").map((id, i) => [id, createRuntime(id, i)]));
  // remap seats after createFreshPlayers
  for (const p of state.players) {
    if (p.id !== "hero") runtimes[p.id] = createRuntime(p.id, p.seat);
  }
  let guard = 0;
  while (state.street !== "complete" && state.toAct !== null && guard++ < 90) {
    const actor = state.players[state.toAct];
    const rt = runtimes[actor.id] ?? createRuntime(actor.id, actor.seat);
    const d = decideVillain(state, rt, 0.78, true);
    state = applyAction(state, d.type, d.raiseTo);
  }
  return state;
}

export function roundRobin(hands = 1200): SimRow[] {
  const ids = VILLAINS.map((v) => v.id);
  const acc = Object.fromEntries(ids.map((id) => [id, { bb: 0, hands: 0 }]));
  let n = 0;
  while (n < hands) {
    const shuffled = [...ids].sort(() => (n * 17 + 3) % 2 ? 1 : -1);
    for (let i = 0; i < ids.length; i++) {
      const table = [];
      for (let k = 0; k < 6; k++) table.push(shuffled[(i + k) % shuffled.length]);
      const state = playHand(table, n % 6, `rr:${n}`, n + 1);
      if (state.result) {
        for (const id of table) {
          acc[id].bb += chipsToBb(state.result.deltas[id] ?? 0, state.bb);
          acc[id].hands += 1;
        }
      }
      n += 1;
      if (n >= hands) break;
    }
  }
  return VILLAINS.map((v) => ({
    id: v.id,
    name: v.name,
    hands: acc[v.id].hands,
    bb100: acc[v.id].hands ? (acc[v.id].bb / acc[v.id].hands) * 100 : 0,
  })).sort((a, b) => b.bb100 - a.bb100);
}

export function exploitProbe(targetId: string, hands = 200): number {
  let bb = 0;
  for (let i = 0; i < hands; i++) {
    // hero here is also a villain-policy seat named hero — use professor as filler and target as first
    const table = [targetId, "nitlee", "uncleho", "stationpark", "foldjeong", "weekend"];
    const state = playHand(table, i % 6, `ex:${targetId}:${i}`, i + 1);
    if (state.result) bb += chipsToBb(state.result.deltas[targetId] ?? 0, state.bb);
  }
  return (bb / hands) * 100;
}

export interface BehaviorRow {
  id: string;
  name: string;
  archetype: string;
  hands: number;
  vpip: number;
  vpipSpec: number;
  pfr: number;
  pfrSpec: number;
  af: number;
  afSpec: number;
  cbet: number;
  cbetSpec: number;
  ok: boolean;
}

export function behaviorProbe(hands = 600, seats: 2 | 4 | 6 = 6): BehaviorRow[] {
  const ids = VILLAINS.map((v) => v.id);
  const acc: Record<string, { hands: number; vpip: number; pfr: number; bets: number; calls: number; flop: number; cbet: number }> = {};
  for (const id of ids) acc[id] = { hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, flop: 0, cbet: 0 };

  for (let n = 0; n < hands; n++) {
    const table: string[] = [];
    for (let k = 0; k < seats; k++) table.push(ids[(n + k) % ids.length]);
    const state = playHand(table, n % seats, `probe:${seats}:${n}`, n + 1);
    if (!state.result) continue;
    for (const p of state.players) {
      const a = acc[p.id];
      if (!a) continue;
      a.hands += 1;
      const mine = state.actionLog.filter((x) => x.actorId === p.id);
      const pre = mine.filter((x) => x.street === "preflop");
      if (pre.some((x) => x.type !== "fold")) a.vpip += 1;
      if (pre.some((x) => x.type === "raise" || x.type === "bet" || x.type === "allin")) a.pfr += 1;
      a.bets += mine.filter((x) => x.type === "bet" || x.type === "raise" || x.type === "allin").length;
      a.calls += mine.filter((x) => x.type === "call").length;
      const flop = mine.filter((x) => x.street === "flop");
      if (flop.length) {
        a.flop += 1;
        if (flop.some((x) => x.type === "bet" || x.type === "raise")) a.cbet += 1;
      }
    }
  }

  const pct = (x: number, y: number) => (y ? Math.round((x / y) * 1000) / 10 : 0);
  return VILLAINS.map((v) => {
    const a = acc[v.id];
    const vpip = pct(a.vpip, a.hands);
    const pfr = pct(a.pfr, a.hands);
    const af = a.calls ? Math.round((a.bets / a.calls) * 100) / 100 : a.bets;
    const cbet = pct(a.cbet, a.flop);
    const spec = v.baseStats;
    return {
      id: v.id,
      name: v.name,
      archetype: v.archetype,
      hands: a.hands,
      vpip,
      vpipSpec: spec.vpip,
      pfr,
      pfrSpec: spec.pfr,
      af,
      afSpec: spec.aggressionFactor,
      cbet,
      cbetSpec: spec.cbetFlop ?? 0,
      ok: Math.abs(vpip - spec.vpip) <= 12 && Math.abs(pfr - spec.pfr) <= 12,
    };
  }).sort((a, b) => b.vpip - a.vpip);
}
