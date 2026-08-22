import { cardKey, makeDeck } from "../engine/cards";
import { applyAction, cloneState, legalActions, type TableState } from "../engine/game";
import { readSpot } from "../engine/handRank";
import { Rng } from "../engine/rng";
import { chipsToBb, type ActionType, type Street } from "../engine/types";
import { decideVillain, type PolicyMode } from "../villains/policy";
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
  played: CandidateEv;
  lossBb: number;
  samples: number;
  baselineCandidates?: CandidateEv[];
  baselineBest?: CandidateEv;
  baselinePlayed?: CandidateEv;
  baselineLossBb?: number;
}

function dollarsFromChips(chips: number): string {
  const dollars = Math.round((chips / 100) * 100) / 100;
  const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2).replace(/0$/, "");
  return `$${body}`;
}

export interface DecisionSnapshot {
  snapshot: TableState;
  runtimes: Record<string, VillainRuntime>;
  heroType: ActionType;
  heroRaiseTo: number;
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

function finish(
  state: TableState,
  runtimes: Record<string, VillainRuntime>,
  tell: number,
  mode: PolicyMode,
  guard = 80,
): TableState {
  let cur = state;
  let n = 0;
  while (cur.street !== "complete" && cur.toAct !== null && n++ < guard) {
    const actor = cur.players[cur.toAct];
    if (actor.id === "hero") {
      const move = heroContinue(cur);
      cur = applyAction(cur, move.type, move.raiseTo);
    } else {
      const rt = runtimes[actor.id] ?? createRuntime(actor.id, actor.seat);
      const d = decideVillain(cur, rt, tell, true, mode);
      cur = applyAction(cur, d.type, d.raiseTo);
    }
  }
  return cur;
}

function resampleHiddenCards(state: TableState, sample: number): TableState {
  const next = cloneState(state);
  const hero = next.players.find((p) => p.id === "hero");
  const known = [...next.board, ...(hero?.hole ?? [])];
  const used = new Set(known.map(cardKey));
  const available = makeDeck().filter((card) => !used.has(cardKey(card)));
  const rng = new Rng(`${state.seed}:${state.handNumber}:${state.actionLog.length}:decision-ev:${sample}`);
  const deck = rng.shuffle(available);

  for (const player of next.players) {
    if (player.id === "hero") continue;
    player.hole = [deck.pop()!, deck.pop()!];
  }
  next.deck = deck;
  return next;
}

export function evForAction(
  state: TableState,
  type: ActionType,
  raiseTo: number,
  runtimes: Record<string, VillainRuntime>,
  samples: number,
  tell = 0.78,
  mode: PolicyMode = "exploit",
): number {
  let sum = 0;
  const count = Math.max(1, samples);
  for (let i = 0; i < count; i++) {
    const sampled = resampleHiddenCards(state, i);
    const branched = applyAction(sampled, type, raiseTo);
    const done = finish(branched, runtimes, tell, mode);
    sum += done.result?.heroDelta ?? 0;
  }
  return chipsToBb(sum / count, state.bb);
}

function actionLabel(type: ActionType, raiseTo: number): string {
  if (type === "fold") return "폴드";
  if (type === "check") return "체크";
  if (type === "call") return "콜";
  if (type === "allin") return "올인";
  return `${type === "bet" ? "벳" : "레이즈"} ${dollarsFromChips(raiseTo)}`;
}

export function candidateList(state: TableState): { type: ActionType; raiseTo: number; label: string }[] {
  if (state.toAct === null) return [];
  const legal = legalActions(state, state.toAct);
  const out: { type: ActionType; raiseTo: number; label: string }[] = [];
  if (legal.canFold) out.push({ type: "fold", raiseTo: 0, label: "폴드" });
  if (legal.canCheck) out.push({ type: "check", raiseTo: 0, label: "체크" });
  if (legal.canCall) out.push({ type: "call", raiseTo: 0, label: `콜 ${dollarsFromChips(legal.callAmount)}` });
  if (legal.canBet) {
    const pot = Math.max(legal.pot, state.bb);
    const sizes = [
      { label: "33%", to: Math.min(legal.maxRaiseTo, Math.max(legal.minBet, Math.round(pot * 0.33))) },
      { label: "75%", to: Math.min(legal.maxRaiseTo, Math.max(legal.minBet, Math.round(pot * 0.75))) },
      { label: "팟", to: Math.min(legal.maxRaiseTo, Math.max(legal.minBet, pot)) },
    ];
    const player = state.players[state.toAct];
    const remaining = legal.maxRaiseTo - player.contributedStreet;
    if (remaining <= pot * 2 || legal.callAmount >= player.stack * 0.35) {
      sizes.push({ label: "올인", to: legal.maxRaiseTo });
    }
    const seen = new Set<number>();
    for (const s of sizes) {
      if (seen.has(s.to)) continue;
      seen.add(s.to);
      out.push({ type: legal.callAmount > 0 ? "raise" : "bet", raiseTo: s.to, label: `${s.label} ${dollarsFromChips(s.to)}` });
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
  tell = 0.78,
): DecisionEv {
  const cands = candidateList(snapshot);
  const sized = heroType === "bet" || heroType === "raise" || heroType === "allin";
  const scoreMode = (mode: PolicyMode) => {
    const scored: CandidateEv[] = cands.map((candidate) => ({
      action: candidate.type,
      raiseTo: candidate.raiseTo,
      label: candidate.label,
      ev: evForAction(snapshot, candidate.type, candidate.raiseTo, runtimes, samples, tell, mode),
    }));
    const played = scored.find((candidate) => candidate.action === heroType && (!sized || candidate.raiseTo === heroRaiseTo)) ?? {
      action: heroType,
      raiseTo: heroRaiseTo,
      label: actionLabel(heroType, heroRaiseTo),
      ev: evForAction(snapshot, heroType, heroRaiseTo, runtimes, samples, tell, mode),
    };
    if (!scored.includes(played)) scored.push(played);
    const best = scored.reduce((a, b) => (b.ev > a.ev ? b : a), scored[0] ?? played);
    const lossBb = Math.max(0, Math.round((best.ev - played.ev) * 10) / 10);
    return { candidates: scored.sort((a, b) => b.ev - a.ev), best, played, lossBb };
  };
  const exploit = scoreMode("exploit");
  const baseline = scoreMode("baseline");
  return {
    index: snapshot.actionLog.length,
    street: snapshot.street as Street,
    heroAction: { type: heroType, amount: heroRaiseTo },
    candidates: exploit.candidates,
    best: exploit.best,
    played: exploit.played,
    lossBb: exploit.lossBb,
    samples: Math.max(1, samples),
    baselineCandidates: baseline.candidates,
    baselineBest: baseline.best,
    baselinePlayed: baseline.played,
    baselineLossBb: baseline.lossBb,
  };
}

export function scoreDecisions(
  decisions: DecisionSnapshot[],
  samples: number,
  tell = 0.78,
): DecisionEv[] {
  return decisions.map((decision) =>
    scoreDecision(
      decision.snapshot,
      decision.heroType,
      decision.heroRaiseTo,
      decision.runtimes,
      samples,
      tell,
    ),
  );
}
