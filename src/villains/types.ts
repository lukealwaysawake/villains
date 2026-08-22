import type { Emotion, LeakType, Position, Tier } from "../engine/types";

export interface PokerStats {
  vpip: number;
  pfr: number;
  threeBet: number;
  foldToThreeBet: number;
  fourBet: number;
  foldToFourBet: number;
  cbetFlop: number;
  cbetTurn: number;
  cbetRiver: number;
  foldToCbetFlop: number;
  foldToCbetTurn: number;
  foldToCbetRiver: number;
  turnBarrel: number;
  riverBluffFreq: number;
  checkRaiseFlop: number;
  donkBetFreq: number;
  showdownCalldownThreshold: number;
  wtsd: number;
  aggressionFactor: number;
  positionAwareness: number;
  betSizingProfile: "small" | "standard" | "large" | "overbet";
}

export interface Leak {
  type: LeakType;
  magnitude: number;
  condition?: string;
  discoveryHint: string;
  expectedEdge: number;
  label: string;
}

export interface AdaptationRule {
  id: string;
  when: string;
  effect: string;
}

export type TriggerType =
  | "WIN_BIG"
  | "LOSE_BIG"
  | "BAD_BEAT"
  | "TILT_ENTER"
  | "SCARED_ENTER"
  | "BLUFF_SHOWN"
  | "HERO_BLUFF_SHOWN"
  | "STEAL_SUCCESS"
  | "LONG_FOLD"
  | "HERO_TANK"
  | "SESSION_START"
  | "STACK_LEAD";

export interface VillainDef {
  id: string;
  name: string;
  handle: string;
  tier: Tier;
  archetype: string;
  color: string;
  accent: string;
  mark: string;
  talk: string;
  baseStats: PokerStats;
  positionalStats?: Partial<Record<Position, Partial<PokerStats>>>;
  leaks: Leak[];
  emotionProfile: {
    sensitivity: number;
    tiltThreshold: number;
    tiltDuration: number;
    scaredThreshold: number;
    confidentThreshold: number;
  };
  adaptationLevel: 1 | 2 | 3;
  adaptationRules?: AdaptationRule[];
  verbosity: number;
  lines: Partial<Record<TriggerType, string[]>>;
  timingTell?: boolean;
  unlock: string;
  lesson: string;
  exploit: string;
  expectedBb100: string;
}

export interface HeroReadModel {
  hands: number;
  cbetFoldRate: number;
  threeBetFreq: number;
  showdownBluffCount: number;
  avgAggression: number;
  riverCalldownRate: number;
  foldToOverbet: number;
  overbetFaced: number;
}

export interface VillainRuntime {
  villainId: string;
  seat: number;
  emotion: Emotion;
  emotionRemainingHands: number;
  heroRead: HeroReadModel;
  dialogueCooldowns: Record<string, number>;
  sessionSpeechCount: number;
  lastLine: string | null;
  lastTrigger: string | null;
  overbetBluffBoostUntil: number;
  cbetBoost: number;
  fourBetBoost: number;
}

export function emptyHeroRead(): HeroReadModel {
  return {
    hands: 0,
    cbetFoldRate: 0.45,
    threeBetFreq: 0.07,
    showdownBluffCount: 0,
    avgAggression: 2.2,
    riverCalldownRate: 0.4,
    foldToOverbet: 0.5,
    overbetFaced: 0,
  };
}

export function createRuntime(villainId: string, seat: number): VillainRuntime {
  return {
    villainId,
    seat,
    emotion: "NORMAL",
    emotionRemainingHands: 0,
    heroRead: emptyHeroRead(),
    dialogueCooldowns: {},
    sessionSpeechCount: 0,
    lastLine: null,
    lastTrigger: null,
    overbetBluffBoostUntil: 0,
    cbetBoost: 0,
    fourBetBoost: 0,
  };
}
