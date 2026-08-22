export type Suit = 0 | 1 | 2 | 3;
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Street = "preflop" | "flop" | "turn" | "river";
export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";
export type Emotion = "NORMAL" | "TILT" | "SCARED" | "CONFIDENT";
export type LeakType =
  | "RANGE"
  | "FOLD_FREQ"
  | "STREET_GAP"
  | "POSITIONAL"
  | "SIZING_TELL"
  | "STACK_MISREAD"
  | "EMOTIONAL"
  | "PHYSICAL";
export type Tier = "S" | "A" | "B" | "C";
export type ReviewSeverity = "green" | "yellow" | "red";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface Action {
  street: Street;
  seat: number;
  actorId: string;
  type: ActionType;
  amount: number;
  toCall: number;
  potBefore: number;
  timeMs: number;
}

export interface Pot {
  amount: number;
  eligibleSeats: number[];
}

export interface PlayerState {
  id: string;
  seat: number;
  stack: number;
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  contributedStreet: number;
  contributedHand: number;
  actedStreet: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  pot: number;
}

export interface HandResult {
  winnersByPot: { potIndex: number; seats: number[]; amount: number }[];
  shown: Record<number, [Card, Card]>;
  heroDelta: number;
  deltas: Record<string, number>;
}

export const CHIP = 100;
export const BB = 100;
export const SB = 50;
export const START_STACK = 10000;

export function chipsToBb(chips: number): number {
  return Math.round((chips / BB) * 10) / 10;
}

export function bbToChips(bb: number): number {
  return Math.round(bb * BB);
}
