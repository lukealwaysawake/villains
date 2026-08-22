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
  while (state.street !== "complete" && state.toAct !== null && guard++ < 120) {
    const actor = state.players[state.toAct];
    const rt = runtimes[actor.id] ?? createRuntime(actor.id, actor.seat);
    const d = decideVillain(state, rt, 0.78);
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
          acc[id].bb += chipsToBb(state.result.deltas[id] ?? 0);
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
    const ids = ["hero", targetId, "songtag", "nitlee", "uncleho", "foldjeong"];
    // hero here is also a villain-policy seat named hero — use professor as filler and target as first
    const table = [targetId, "nitlee", "uncleho", "stationpark", "foldjeong", "weekend"];
    const state = playHand(table, i % 6, `ex:${targetId}:${i}`, i + 1);
    if (state.result) bb += chipsToBb(state.result.deltas[targetId] ?? 0);
  }
  return (bb / hands) * 100;
}
