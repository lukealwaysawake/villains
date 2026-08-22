import { shuffleDeck } from "./cards";
import { evaluateBest } from "./handRank";
import { Rng } from "./rng";
import {
  BB,
  SB,
  START_STACK,
  type Action,
  type ActionType,
  type Card,
  type HandResult,
  type LegalActions,
  type PlayerState,
  type Position,
  type Pot,
  type Street,
} from "./types";

export interface TableState {
  handNumber: number;
  seed: string;
  street: Street | "showdown" | "complete";
  board: Card[];
  deck: Card[];
  button: number;
  players: PlayerState[];
  currentBet: number;
  lastRaiseSize: number;
  lastFullRaiser: number | null;
  toAct: number | null;
  playersToAct: number;
  pots: Pot[];
  actionLog: Action[];
  result: HandResult | null;
  startedAt: number;
}

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export function cloneState(state: TableState): TableState {
  return structuredClone(state);
}

export function seatOf(state: TableState, id: string): number {
  return state.players.find((p) => p.id === id)!.seat;
}

export function playerAt(state: TableState, seat: number): PlayerState {
  return state.players[seat];
}

export function livePlayers(state: TableState): PlayerState[] {
  return state.players.filter((p) => !p.folded);
}

export function actorsLeft(state: TableState): PlayerState[] {
  return state.players.filter((p) => !p.folded && !p.allIn);
}

export function potTotal(state: TableState): number {
  const committed = state.players.reduce((s, p) => s + p.contributedHand, 0);
  return committed;
}

export function streetPot(state: TableState): number {
  return state.players.reduce((s, p) => s + p.contributedStreet, 0);
}

export function positionFor(button: number, seat: number, seats = 6): Position {
  const order: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
  const offset = (seat - button + seats) % seats;
  return order[offset];
}

export function positionsMap(button: number, seats = 6): Record<number, Position> {
  const map: Record<number, Position> = {};
  for (let i = 0; i < seats; i++) map[i] = positionFor(button, i, seats);
  return map;
}

function nextSeat(from: number, seats = 6): number {
  return (from + 1) % seats;
}

function firstLiveFrom(state: TableState, from: number): number | null {
  const n = seatCount(state);
  for (let i = 0; i < n; i++) {
    const seat = (from + i) % n;
    const p = state.players[seat];
    if (!p.folded && !p.allIn) return seat;
  }
  return null;
}

export function createFreshPlayers(ids: string[]): PlayerState[] {
  return ids.map((id, seat) => ({
    id,
    seat,
    stack: START_STACK,
    hole: null,
    folded: false,
    allIn: false,
    contributedStreet: 0,
    contributedHand: 0,
    actedStreet: false,
  }));
}

function post(state: TableState, seat: number, amount: number): void {
  const p = state.players[seat];
  const pay = Math.min(p.stack, amount);
  p.stack -= pay;
  p.contributedStreet += pay;
  p.contributedHand += pay;
  if (p.stack === 0) p.allIn = true;
}

export function startHand(args: {
  players: PlayerState[];
  button: number;
  handNumber: number;
  seed: string;
}): TableState {
  const rng = new Rng(`${args.seed}:h${args.handNumber}`);
  const deck = shuffleDeck(rng);
  const players = args.players.map((p) => ({
    ...p,
    hole: null as [Card, Card] | null,
    folded: p.stack <= 0,
    allIn: false,
    contributedStreet: 0,
    contributedHand: 0,
    actedStreet: false,
    stack: p.stack <= 0 ? START_STACK : p.stack,
  }));
  for (const p of players) {
    if (p.stack < BB) p.stack = START_STACK;
  }

  const state: TableState = {
    handNumber: args.handNumber,
    seed: args.seed,
    street: "preflop",
    board: [],
    deck,
    button: args.button,
    players,
    currentBet: BB,
    lastRaiseSize: BB,
    lastFullRaiser: null,
    toAct: null,
    playersToAct: 0,
    pots: [],
    actionLog: [],
    result: null,
    startedAt: Date.now(),
  };

  for (const p of state.players) {
    p.hole = [state.deck.pop()!, state.deck.pop()!];
  }

  const n = seatCount(state);
  const sb = nextSeat(state.button, n);
  const bb = nextSeat(sb, n);
  post(state, sb, SB);
  post(state, bb, BB);
  state.lastFullRaiser = bb;
  const utg = nextSeat(bb, n);
  state.toAct = firstLiveFrom(state, utg);
  state.playersToAct = actorsLeft(state).length;
  if (livePlayers(state).length < 2) finishUncontested(state);
  return state;
}

export function legalActions(state: TableState, seat: number): LegalActions {
  const p = state.players[seat];
  const toCall = Math.max(0, state.currentBet - p.contributedStreet);
  const pot = potTotal(state);
  const minBet = Math.min(p.stack, BB);
  const minRaiseTo = Math.min(p.stack + p.contributedStreet, state.currentBet + state.lastRaiseSize);
  const maxRaiseTo = p.stack + p.contributedStreet;
  const canCall = toCall > 0 && p.stack > 0;
  const canCheck = toCall === 0 && !p.folded;
  const canBet = toCall === 0 && p.stack > 0 && state.currentBet === 0;
  const canRaise = toCall > 0 && p.stack > toCall;
  return {
    canFold: !p.folded && toCall > 0,
    canCheck,
    canCall,
    callAmount: Math.min(toCall, p.stack),
    canBet: canBet || canRaise,
    minBet: canBet ? minBet : minRaiseTo,
    minRaiseTo,
    maxRaiseTo,
    pot,
  };
}

function resetStreetFlags(state: TableState, closer: number | null): void {
  for (const p of state.players) p.actedStreet = false;
  if (closer !== null) state.players[closer].actedStreet = true;
  state.playersToAct = actorsLeft(state).filter((p) => p.seat !== closer).length;
}

function advanceOrClose(state: TableState): void {
  if (livePlayers(state).length === 1) {
    finishUncontested(state);
    return;
  }
  if (actorsLeft(state).length === 0) {
    runout(state);
    showdown(state);
    return;
  }
  if (state.playersToAct <= 0) {
    nextStreet(state);
    return;
  }
  const from = nextSeat(state.toAct ?? 0, seatCount(state));
  const nxt = firstLiveFrom(state, from);
  state.toAct = nxt;
  if (nxt === null) {
    if (livePlayers(state).length === 1) finishUncontested(state);
    else {
      runout(state);
      showdown(state);
    }
  }
}

export function applyAction(
  state: TableState,
  type: ActionType,
  raiseTo = 0,
  timeMs = 0,
): TableState {
  const next = cloneState(state);
  if (next.toAct === null || next.street === "complete" || next.street === "showdown") return next;
  const seat = next.toAct;
  const p = next.players[seat];
  const legal = legalActions(next, seat);
  const toCall = Math.max(0, next.currentBet - p.contributedStreet);
  const potBefore = potTotal(next);
  const prevBet = next.currentBet;

  let actual: ActionType = type;
  let amount = 0;
  let reopened = false;

  if (type === "fold") {
    if (!legal.canFold) actual = legal.canCheck ? "check" : "call";
    else {
      p.folded = true;
      actual = "fold";
    }
  }

  if (actual !== "fold" && (actual === "check" || type === "check") && legal.canCheck) {
    actual = "check";
    amount = 0;
  } else if (actual !== "fold" && (type === "call" || actual === "call" || (type === "check" && !legal.canCheck))) {
    actual = "call";
    const pay = Math.min(p.stack, toCall);
    post(next, seat, pay);
    amount = pay;
    if (p.allIn) actual = "allin";
  } else if (actual !== "fold" && (type === "bet" || type === "raise" || type === "allin")) {
    let target = raiseTo;
    if (type === "allin" || target >= p.stack + p.contributedStreet) {
      target = p.stack + p.contributedStreet;
    }
    if (prevBet === 0) target = Math.max(target, legal.minBet);
    else target = Math.max(target, legal.minRaiseTo);
    target = Math.min(target, legal.maxRaiseTo);
    const pay = Math.max(0, target - p.contributedStreet);
    const increment = target - prevBet;
    const isFull = target > prevBet && increment >= next.lastRaiseSize;
    post(next, seat, pay);
    amount = pay;
    if (target > prevBet) {
      if (isFull) {
        next.lastRaiseSize = increment || next.lastRaiseSize;
        next.lastFullRaiser = seat;
        resetStreetFlags(next, seat);
        reopened = true;
      }
      next.currentBet = Math.max(next.currentBet, p.contributedStreet);
      actual = prevBet === 0 ? "bet" : "raise";
    } else {
      actual = "call";
    }
    if (p.allIn) actual = "allin";
  }

  p.actedStreet = true;
  if (!reopened) next.playersToAct = Math.max(0, next.playersToAct - 1);
  next.actionLog.push({
    street: next.street as Street,
    seat,
    actorId: p.id,
    type: actual,
    amount,
    toCall,
    potBefore,
    timeMs,
  });

  advanceOrClose(next);
  return next;
}

function burnAndDeal(state: TableState, n: number): void {
  state.deck.pop();
  for (let i = 0; i < n; i++) state.board.push(state.deck.pop()!);
}

function nextStreet(state: TableState): void {
  if (state.street === "river") {
    showdown(state);
    return;
  }
  const idx = STREETS.indexOf(state.street as Street);
  const nxt = STREETS[idx + 1];
  state.street = nxt;
  for (const p of state.players) {
    p.contributedStreet = 0;
    p.actedStreet = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = BB;
  state.lastFullRaiser = null;
  if (nxt === "flop") burnAndDeal(state, 3);
  else burnAndDeal(state, 1);

  if (actorsLeft(state).length <= 1) {
    runout(state);
    showdown(state);
    return;
  }
  const first = firstLiveFrom(state, nextSeat(state.button, seatCount(state)));
  state.toAct = first;
  state.playersToAct = actorsLeft(state).length;
}

function runout(state: TableState): void {
  while (state.board.length < 5) {
    if (state.board.length === 0) burnAndDeal(state, 3);
    else burnAndDeal(state, 1);
  }
  state.street = "showdown";
  state.toAct = null;
}

function buildPots(state: TableState): Pot[] {
  const contribs = state.players.map((p) => p.contributedHand);
  const levels = [...new Set(contribs.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    let amount = 0;
    const eligible: number[] = [];
    for (const p of state.players) {
      if (p.contributedHand >= level) {
        amount += layer;
        if (!p.folded) eligible.push(p.seat);
      } else if (p.contributedHand > prev) {
        amount += p.contributedHand - prev;
      }
    }
    if (amount > 0) pots.push({ amount, eligibleSeats: eligible });
    prev = level;
  }
  return pots.length ? pots : [{ amount: 0, eligibleSeats: livePlayers(state).map((p) => p.seat) }];
}

function finishUncontested(state: TableState): void {
  const winner = livePlayers(state)[0];
  const pots = buildPots(state);
  const deltas: Record<string, number> = {};
  for (const p of state.players) deltas[p.id] = -p.contributedHand;
  let winAmount = 0;
  for (const pot of pots) {
    winAmount += pot.amount;
  }
  winner.stack += winAmount;
  deltas[winner.id] += winAmount;
  state.pots = pots;
  state.street = "complete";
  state.toAct = null;
  state.result = {
    winnersByPot: pots.map((pot, i) => ({ potIndex: i, seats: [winner.seat], amount: pot.amount })),
    shown: {},
    heroDelta: deltas.hero ?? 0,
    deltas,
  };
}

function showdown(state: TableState): void {
  state.street = "showdown";
  state.toAct = null;
  if (state.board.length < 5) runout(state);
  const pots = buildPots(state);
  const shown: Record<number, [Card, Card]> = {};
  for (const p of state.players) {
    if (!p.folded && p.hole) shown[p.seat] = p.hole;
  }
  const deltas: Record<string, number> = {};
  for (const p of state.players) deltas[p.id] = -p.contributedHand;

  const winnersByPot: HandResult["winnersByPot"] = [];
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const eligible = pot.eligibleSeats
      .map((seat) => state.players[seat])
      .filter((p) => p.hole && !p.folded);
    if (!eligible.length) continue;
    const scored = eligible.map((p) => ({
      seat: p.seat,
      value: evaluateBest([...p.hole!, ...state.board]).value,
    }));
    const best = Math.max(...scored.map((s) => s.value));
    const winners = scored.filter((s) => s.value === best).map((s) => s.seat);
    const share = Math.floor(pot.amount / winners.length);
    let remain = pot.amount - share * winners.length;
    for (const seat of winners) {
      let add = share;
      if (remain > 0) {
        add += 1;
        remain -= 1;
      }
      state.players[seat].stack += add;
      deltas[state.players[seat].id] += add;
    }
    winnersByPot.push({ potIndex: i, seats: winners, amount: pot.amount });
  }

  state.pots = pots;
  state.street = "complete";
  state.result = {
    winnersByPot,
    shown,
    heroDelta: deltas.hero ?? 0,
    deltas,
  };
}

export function sizingPresets(legal: LegalActions): { label: string; to: number }[] {
  const pot = Math.max(legal.pot, BB);
  const toCall = legal.callAmount;
  const maxTo = legal.maxRaiseTo;
  const candidates = [
    { label: "33%", to: Math.round((toCall + pot * 0.33 + toCall) ) },
    { label: "50%", to: Math.round(toCall + pot * 0.5 + toCall) },
    { label: "75%", to: Math.round(toCall + pot * 0.75 + toCall) },
    { label: "팟", to: Math.round(toCall + pot + toCall) },
    { label: "올인", to: maxTo },
  ];
  const seen = new Set<number>();
  return candidates
    .map((c) => ({ ...c, to: Math.min(maxTo, Math.max(legal.minBet, c.to)) }))
    .filter((c) => {
      if (seen.has(c.to)) return false;
      seen.add(c.to);
      return c.to > 0;
    });
}

export function describeAction(action: Action): string {
  const bb = (n: number) => `${Math.round((n / BB) * 10) / 10}bb`;
  switch (action.type) {
    case "fold":
      return "폴드";
    case "check":
      return "체크";
    case "call":
      return `콜 ${bb(action.amount)}`;
    case "bet":
      return `벳 ${bb(action.amount)}`;
    case "raise":
      return `레이즈 ${bb(action.amount)}`;
    case "allin":
      return `올인 ${bb(action.amount)}`;
  }
}
aise":
      return `레이즈 ${bb(action.amount)}`;
    case "allin":
      return `올인 ${bb(action.amount)}`;
  }
}
 ${bb(action.amount)}`;
  }
}
