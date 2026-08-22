import { chenPercentile } from "../engine/chen";
import { equityVsRandom, potOdds } from "../engine/equity";
import { preflopStrength, readSpot } from "../engine/handRank";
import { legalActions, positionFor, potTotal, type TableState } from "../engine/game";
import { Rng } from "../engine/rng";
import { BB, type ActionType, type Position, type Street } from "../engine/types";
import { VILLAIN_BY_ID } from "./catalog";
import type { PokerStats, VillainRuntime } from "./types";

export interface PolicyDecision {
  type: ActionType;
  raiseTo: number;
  delayMs: number;
  mixKey: string;
}

const POS_OPEN_MULT: Record<Position, number> = {
  UTG: 0.62,
  MP: 0.78,
  CO: 1.05,
  BTN: 1.28,
  SB: 0.95,
  BB: 0.55,
};

const POS_NORM = 6 / Object.values(POS_OPEN_MULT).reduce((s, v) => s + v, 0);

function mergedStats(id: string, pos: Position): PokerStats {
  const def = VILLAIN_BY_ID[id];
  return { ...def.baseStats, ...(def.positionalStats?.[pos] ?? {}) };
}

function emotionScale(runtime: VillainRuntime) {
  switch (runtime.emotion) {
    case "TILT":
      return { vpip: 1.9, agg: 1.4, fold: 0.5, bluff: 2.4 };
    case "SCARED":
      return { vpip: 0.8, agg: 0.6, fold: 1.3, bluff: 0.2 };
    case "CONFIDENT":
      return { vpip: 1.15, agg: 1.2, fold: 0.9, bluff: 1.3 };
    default:
      return { vpip: 1, agg: 1, fold: 1, bluff: 1 };
  }
}

function applyVendettaTilt(id: string, runtime: VillainRuntime, stats: PokerStats): PokerStats {
  if (id !== "vendetta" || runtime.emotion !== "TILT") return stats;
  return {
    ...stats,
    vpip: 55,
    pfr: 42,
    threeBet: 21,
    foldToCbetFlop: 26,
    riverBluffFreq: 44,
    aggressionFactor: 4.2,
    showdownCalldownThreshold: 0.18,
  };
}

function percentile(holeStrength: number): number {
  return chenPercentile(holeStrength);
}

function sizingTo(state: TableState, seat: number, potFrac: number, overbet = false): number {
  const p = state.players[seat];
  const legal = legalActions(state, seat);
  const toCall = legal.callAmount;
  const pot = Math.max(legal.pot, state.bb || BB);
  const frac = overbet ? 1.25 : potFrac;
  const add = Math.round(toCall + pot * frac + toCall);
  const target = p.contributedStreet + Math.max(legal.minBet - p.contributedStreet, add - p.contributedStreet);
  return Math.max(legal.minBet, Math.min(legal.maxRaiseTo, target));
}

function profileFrac(profile: PokerStats["betSizingProfile"]): number {
  if (profile === "small") return 0.4;
  if (profile === "large") return 0.8;
  if (profile === "overbet") return 1.05;
  return 0.66;
}

function facingBets(state: TableState): number {
  return state.actionLog.filter((a) => a.street === state.street && (a.type === "bet" || a.type === "raise" || a.type === "allin")).length;
}

function foldFreqForStreet(stats: PokerStats, street: Street): number {
  if (street === "flop") return stats.foldToCbetFlop;
  if (street === "turn") return stats.foldToCbetTurn;
  if (street === "river") return stats.foldToCbetRiver;
  return stats.foldToThreeBet;
}

function cbetFreq(stats: PokerStats, street: Street, runtime: VillainRuntime): number {
  let f = street === "flop" ? stats.cbetFlop : street === "turn" ? stats.turnBarrel : stats.cbetRiver;
  if (runtime.cbetBoost) f = Math.max(f, runtime.cbetBoost);
  return f;
}

export function decideVillain(
  state: TableState,
  runtime: VillainRuntime,
  tellDifficulty = 0.78,
  fast = false,
): PolicyDecision {
  const seat = state.toAct!;
  const player = state.players[seat];
  const def = VILLAIN_BY_ID[runtime.villainId];
  const pos = positionFor(state.button, seat);
  const emo = emotionScale(runtime);
  let stats = applyVendettaTilt(def.id, runtime, mergedStats(def.id, pos));
  stats = {
    ...stats,
    vpip: Math.min(90, stats.vpip * emo.vpip),
    pfr: Math.min(80, stats.pfr * emo.agg),
    threeBet: Math.min(40, stats.threeBet * emo.agg),
    foldToThreeBet: Math.min(95, stats.foldToThreeBet * emo.fold),
    foldToCbetFlop: Math.min(95, stats.foldToCbetFlop * emo.fold),
    foldToCbetTurn: Math.min(95, stats.foldToCbetTurn * emo.fold),
    foldToCbetRiver: Math.min(95, stats.foldToCbetRiver * emo.fold),
    riverBluffFreq: Math.min(80, stats.riverBluffFreq * emo.bluff),
    aggressionFactor: stats.aggressionFactor * emo.agg,
  };

  const rng = new Rng(`${state.seed}:${state.handNumber}:${state.actionLog.length}:${def.id}`);
  const legal = legalActions(state, seat);
  const hole = player.hole!;
  const pf = preflopStrength(hole);
  const pfPct = percentile(pf);
  const toCall = legal.callAmount;
  const pot = potTotal(state);
  const bigBlind = state.bb || BB;
  const potBb = pot / bigBlind;
  const street = state.street === "complete" || state.street === "showdown" ? "river" : state.street;
  const raises = facingBets(state);
  const mixKey = `${def.id}:${street}:${pos}:${Math.round(pf)}:${toCall > 0}`;

  const jeongBig = def.id === "foldjeong" && street === "river" && toCall >= pot * 0.75;
  const jeongSmall = def.id === "foldjeong" && street === "river" && toCall > 0 && toCall <= pot * 0.4;
  const weekendScare = def.id === "weekend" && potBb >= 60;
  const ironOop = def.id === "irongate" && (pos === "SB" || pos === "BB") && street === "flop" && toCall > 0;
  const kimOver = def.id === "ceokim" && street === "river";
  const tourneyCommit = def.id === "tourneymin";
  const station = def.id === "stationpark";
  const uncle = def.id === "uncleho";
  const nit = def.id === "nitlee";
  const song = def.id === "songtag";
  const madamBtn = def.id === "madamj" && pos === "BTN";
  const dozer = def.id === "bulldozer";

  let delayMs = Math.round(rng.range(420, 1100));
  if (def.timingTell) {
    const read = street === "preflop" ? { strength: pf / 100, made: pf > 70 ? "toppair" : "air" } : readSpot(hole, state.board);
    const reverse = rng.float() > tellDifficulty;
    const strong = read.strength >= 0.72;
    const bluffish = read.strength <= 0.2;
    if (!reverse) {
      if (strong) delayMs = Math.round(rng.range(700, 1400));
      else if (bluffish) delayMs = Math.round(rng.range(4200, 5600));
      else delayMs = Math.round(rng.range(2300, 3500));
    } else {
      if (strong) delayMs = Math.round(rng.range(4000, 5200));
      else delayMs = Math.round(rng.range(800, 1400));
    }
  }

  const act = (type: ActionType, raiseTo = 0): PolicyDecision => ({ type, raiseTo, delayMs, mixKey });

  if (street === "preflop") {
    const posMul = POS_OPEN_MULT[pos] * POS_NORM;
    const posWeight = 1 + (posMul - 1) * stats.positionAwareness;
    const vpipThresh = stats.vpip * posWeight * 1.12;
    const openThresh = Math.min(vpipThresh, stats.pfr * posWeight * 2.6);
    // Passive types limp the tail of their range instead of raising it.
    const passivity = 1 - Math.min(1, stats.pfr / Math.max(1, stats.vpip));
    const limpThresh = passivity > 0.45 ? vpipThresh : 0;
    if (toCall === 0 || (toCall <= bigBlind && raises === 0 && player.contributedStreet >= bigBlind)) {
      const stealWide = madamBtn ? 1.5 : 1;
      if (pfPct <= openThresh * stealWide && legal.canBet) {
        const frac = pos === "BTN" || pos === "CO" ? 2.3 : 2.5;
        return act("raise", sizingTo(state, seat, frac / 3));
      }
      if (pfPct <= limpThresh && legal.canCall) return act("call");
      if (legal.canCheck) return act("check");
      if (pfPct <= vpipThresh && legal.canCall && toCall <= bigBlind) return act("call");
      return act("fold");
    }

    const facingOpen = toCall <= bigBlind * 3.5 && raises <= 1;
    const facing3 = raises >= 2;
    const facing4 = raises >= 3;

    if (facing4) {
      const value4 = pf >= 86;
      if (song) return value4 && (hole[0].rank >= 12 && hole[0].rank === hole[1].rank || (hole[0].rank === 14 && hole[1].rank === 13))
        ? act(legal.maxRaiseTo <= player.stack + player.contributedStreet ? "raise" : "call", legal.maxRaiseTo)
        : legal.canFold ? act("fold") : act("call");
      if (rng.chance(stats.foldToFourBet / 100) && !value4) return act("fold");
      return value4 ? act("raise", legal.maxRaiseTo) : act("call");
    }

    if (facing3) {
      const fourBetRange = stats.fourBet * (runtime.fourBetBoost || 1);
      if (pfPct <= fourBetRange && legal.canBet) return act("raise", sizingTo(state, seat, 1.1));
      if (rng.chance(stats.foldToThreeBet / 100) && pfPct > Math.min(18, stats.threeBet)) return act("fold");
      if (pfPct <= vpipThresh * 0.55) return act("call");
      return nit || song ? act("fold") : act(rng.chance(0.25) ? "call" : "fold");
    }

    if (facingOpen) {
      const threeBetRange = stats.threeBet * (1 + 0.5 * Math.max(0, stats.aggressionFactor - 2.4));
      if (pfPct <= threeBetRange && legal.canBet) return act("raise", sizingTo(state, seat, 0.95));
      if (uncle && pfPct <= stats.vpip) return act("call");
      if (pfPct <= vpipThresh) {
        // Callers call, raisers mix in a squeeze.
        if (passivity > 0.4) return act("call");
        if (legal.canBet && pfPct <= threeBetRange * 1.8 && rng.chance(0.35 + 0.1 * Math.max(0, stats.aggressionFactor - 2.5))) {
          return act("raise", sizingTo(state, seat, 0.95));
        }
        return act(rng.chance(0.55) ? "call" : "fold");
      }
      if (pos === "BB" && pfPct <= vpipThresh * 1.25) return act("call");
      return act("fold");
    }

    if (pfPct <= openThresh && legal.canBet) return act("raise", sizingTo(state, seat, 0.7));
    if (legal.canCheck) return act("check");
    if (pfPct <= vpipThresh) return act("call");
    return act("fold");
  }

  const read = readSpot(hole, state.board);
  if (!fast && state.board.length >= 3) {
    const eq = equityVsRandom(hole, state.board, 24, `${state.seed}:${state.handNumber}:${def.id}`);
    read.strength = Math.min(0.995, read.strength * 0.55 + eq * 0.45);
  }
  let calldown = stats.showdownCalldownThreshold;
  if (station) calldown = 0.2;
  if (tourneyCommit && read.made === "toppair") calldown = 0.15;
  if (weekendScare) calldown += 0.22;

  let foldF = foldFreqForStreet(stats, street) / 100;
  if (ironOop) foldF = 0.68 * emo.fold;
  if (jeongBig) foldF = 0.71 * emo.fold;
  if (jeongSmall) foldF = 0.18;
  if (station && street === "river") foldF = 0.12;
  if (weekendScare) foldF = Math.min(0.92, foldF + 0.35);
  if (def.id === "greatwhite" && street === "river") foldF = Math.max(0.28, foldF - 0.04);

  const value = read.strength >= 0.6;
  const monster = read.strength >= 0.82;
  const air = read.strength <= 0.2;
  const passivePost = stats.aggressionFactor < 1.5;
  const draw = read.flushDraw || read.oesd;

  if (toCall > 0) {
    const odds = potOdds(toCall, pot);
    if (monster) {
      if (stats.aggressionFactor >= 2.4 && legal.canBet && rng.chance(0.45)) {
        return act("raise", sizingTo(state, seat, profileFrac(stats.betSizingProfile), kimOver));
      }
      return act("call");
    }
    if (!passivePost && raises <= 1 && legal.canBet && stats.aggressionFactor >= 2.4 && read.strength >= 0.62 && rng.chance(Math.min(0.45, stats.aggressionFactor / 9))) {
      return act("raise", sizingTo(state, seat, profileFrac(stats.betSizingProfile), kimOver));
    }
    if (read.strength >= calldown) return act("call");
    if (read.strength + 0.03 >= odds && !nit) return act("call");
    if (tourneyCommit && (read.made === "toppair" || read.made === "overpair") && legal.canBet && toCall >= player.stack * 0.35) {
      return act("allin", legal.maxRaiseTo);
    }
    if (draw && toCall <= pot * 0.45) return act("call");
    if (nit && street === "river" && (legal.canBet && toCall > 0) && read.strength >= 0.7) return act("raise", legal.maxRaiseTo);
    if (rng.chance(foldF) && !value) return act("fold");
    if (value || (station && read.made !== "air")) return act("call");
    if (draw) return act("call");
    return act("fold");
  }

  const betF = cbetFreq(stats, street, runtime) / 100;
  const wasAggressor = state.actionLog.some((a) => a.actorId === def.id && (a.type === "bet" || a.type === "raise") && (street === "flop" ? a.street === "preflop" : true));
  const shouldCbet = wasAggressor || street === "flop";
  let wantBet = false;
  const aggBoost = Math.min(0.3, Math.max(0, (stats.aggressionFactor - 2) * 0.12));
  if (monster || value) wantBet = rng.chance(Math.min(0.97, betF * (passivePost ? 0.7 : 1) + 0.12 + aggBoost));
  else if (draw && street !== "river") wantBet = rng.chance(betF * 0.55);
  else if (air && street === "river") {
    let bluff = stats.riverBluffFreq / 100;
    if (kimOver && runtime.overbetBluffBoostUntil >= state.handNumber) bluff = 0.32;
    if (station) bluff = 0.04;
    wantBet = rng.chance(bluff);
  } else if (shouldCbet) {
    wantBet = rng.chance(dozer && street === "turn" ? 0.38 : betF) && (value || air || draw);
  } else {
    wantBet = rng.chance(stats.donkBetFreq / 100) && value;
  }

  if (dozer && street === "turn" && !value && !monster) wantBet = rng.chance(0.38);

  if (wantBet && legal.canBet) {
    let frac = profileFrac(stats.betSizingProfile);
    let over = false;
    if (kimOver && (monster || (air && runtime.overbetBluffBoostUntil >= state.handNumber))) {
      frac = 1.25;
      over = true;
    }
    if (jeongBig === false && def.id === "foldjeong" && value) frac = 0.38;
    if (def.id === "foldjeong" && air) frac = 0.85;
    if (uncle) frac = 0.4;
    if (weekendScare && value) frac = 0.85;
    return act("bet", sizingTo(state, seat, frac, over));
  }

  return act("check");
}

export function delayFor(decision: PolicyDecision, speed = 1): number {
  return Math.max(180, Math.round(decision.delayMs / speed));
}
