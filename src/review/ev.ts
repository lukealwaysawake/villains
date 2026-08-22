import { applyAction, legalActions, type TableState } from "../engine/game";
import { readSpot } from "../engine/handRank";
import { chipsToBb, type ActionType, type Street } from "../engine/types";
import { decideVillain } from "../villains/policy";
import { createRuntime, type VillainRuntime } from "../villains/types";

export interface CandidateEv {
  action: ActionType;
  raiseTo: number;
  label: string;
  ev: number;
}

export interface DecisionEv {
  index: number;
  street: Street;
  heroAction: { type: ActionType; amount: number };
  candidates: CandidateEv[];
  best: CandidateEv;
  lossBb: number;
}

function heroContinue(state: TableState): { type: ActionType; raiseTo: number } {
  const seat = state.toAct!;
  const p = state.players[seat];
  const legal = legalActions(state, seat);
  const hole = p.hole;
  const read = hole && state.board.length >= 3 ? readSpot(hole, state.board) : { strength: 0.35 };
  if (legal.canCheck) {
    if (read.strength >= 0.72 && legal.canBet) return { type: "bet", raiseTo: Math.min(legal.maxRaiseTo, Math.round(legal.pot * 0.66)) };
    return { type: "check", raiseTo: 0 };
  }
  if (read.strength >= 0.48 && legal.canCall) return { type: "call", raiseTo: 0 };
  if (read.strength >= 0.82 && legal.canBet) return { type: "raise", raiseTo: legal.maxRaiseTo };
  return legal.canFold ? { type: "fold", raiseTo: 0 } : { type: "call", raiseTo: 0 };
}

function finish(state: TableState, runtimes: Record<string, VillainRuntime>, tell: number, guard = 80): TableState {
  let cur = state;
  let n = 0;
  while (cur.street !== "complete" && cur.toAct !== null && n++ < guard) {
    const actor = cur.players[cur.toAct];
    if (actor.id === "hero") {
      const move = heroContinue(cur);
      cur = applyAction(cur, move.type, move.raiseTo);
    } else {
      const rt = runtimes[actor.id] ?? createRuntime(actor.id, actor.seat);
      const d = decideVillain(cur, rt, tell);
      cur = applyAction(cur, d.type, d.raiseTo);
    }
  }
  return cur;
}

export function evForAction(
  state: TableState,
  type: ActionType,
  raiseTo: number,
  runtimes: Record<string, VillainRuntime>,
  samples: number,
  tell = 0.78,
): number {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const branched = applyAction(state, type, raiseTo);
    const done = finish(branched, runtimes, tell);
    sum += done.result?.heroDelta ?? 0;
  }
  return chipsToBb(sum / Math.max(1, samples), state.bb);
}

export function candidateList(state: TableState): { type: ActionType; raiseTo: number; label: string }[] {
  if (state.toAct === null) return [];
  const legal = legalActions(state, state.toAct);
  const out: { type: ActionType; raiseTo: number; label: string }[] = [];
  if (legal.canFold) out.push({ type: "fold", raiseTo: 0, label: "폴드" });
  if (legal.canCheck) out.push({ type: "check", raiseTo: 0, label: "체크" });
  if (legal.canCall) out.push({ type: "call", raiseTo: 0, label: `콜 ${Math.round((legal.callAmount / state.bb) * 10) / 10}bb` });
  if (legal.canBet) {
    const pot = Math.max(legal.pot, state.bb);
    const sizes = [
      { label: "33%", to: Math.min(legal.maxRaiseTo, Math.max(legal.minBet, Math.round(pot * 0.33))) },
      { label: "팟", to: Math.min(legal.maxRaiseTo, Math.max(legal.minBet, pot)) },
      { label: "올인", to: legal.maxRaiseTo },
    ];
    const seen = new Set<number>();
    for (const s of sizes) {
      if (seen.has(s.to)) continue;
      seen.add(s.to);
      out.push({ type: legal.callAmount > 0 ? "raise" : "bet", raiseTo: s.to, label: `${s.label} ${Math.round((s.to / state.bb) * 10) / 10}bb` });
    }
  }
  return out;
}

export function replayToHeroIndex(state: TableState, actionIndex: number): TableState | null {
  let cur: TableState = {
    ...state,
    street: "preflop",
    board: [],
    currentBet: 0,
    lastRaiseSize: state.bb,
    lastFullRaiser: null,
    toAct: null,
    playersToAct: 0,
    actionLog: [],
    result: null,
    players: state.players.map((p) => ({
      ...p,
      stack: p.stack + p.contributedHand,
      folded: false,
      allIn: false,
      contributedStreet: 0,
      contributedHand: 0,
      actedStreet: false,
    })),
  };
  // We cannot cheaply rebuild from scratch without the original deal.
  // Analyze uses live snapshots taken at decision time instead.
  void actionIndex;
  void cur;
  return null;
}

export function scoreDecision(
  snapshot: TableState,
  heroType: ActionType,
  heroRaiseTo: number,
  runtimes: Record<string, VillainRuntime>,
  samples: number,
): DecisionEv {
  const cands = candidateList(snapshot);
  const scored: CandidateEv[] = cands.map((c) => ({
    action: c.type,
    raiseTo: c.raiseTo,
    label: c.label,
    ev: evForAction(snapshot, c.type, c.raiseTo, runtimes, samples),
  }));
  const played = scored.find((c) => c.action === heroType) ?? {
    action: heroType,
    raiseTo: heroRaiseTo,
    label: heroType,
    ev: evForAction(snapshot, heroType, heroRaiseTo, runtimes, samples),
  };
  if (!scored.some((c) => c.action === heroType)) scored.push(played);
  const best = scored.reduce((a, b) => (b.ev > a.ev ? b : a), scored[0]);
  return {
    index: snapshot.actionLog.length,
    street: snapshot.street as Street,
    heroAction: { type: heroType, amount: heroRaiseTo },
    candidates: scored.sort((a, b) => b.ev - a.ev),
    best,
    lossBb: Math.max(0, Math.round((best.ev - played.ev) * 10) / 10),
  };
}
