import type { Card, Rank } from "./types";
import { chenStrength100 } from "./chen";

export const CAT = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export type HandCategory = (typeof CAT)[keyof typeof CAT];

export interface HandScore {
  value: number;
  category: HandCategory;
  ranks: number[];
}

const COMBOS5: number[][] = [];
for (let a = 0; a < 7; a++) {
  for (let b = a + 1; b < 7; b++) {
    for (let c = b + 1; c < 7; c++) {
      for (let d = c + 1; d < 7; d++) {
        for (let e = d + 1; e < 7; e++) COMBOS5.push([a, b, c, d, e]);
      }
    }
  }
}

function pack(category: number, ranks: number[]): number {
  let value = category;
  for (const rank of ranks) value = value * 15 + rank;
  return value;
}

function uniqueStraight(ranksDesc: number[]): number | null {
  const uniq: number[] = [];
  for (const r of ranksDesc) if (uniq[uniq.length - 1] !== r) uniq.push(r);
  if (uniq.includes(14)) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) return uniq[i];
  }
  return null;
}

export function evaluate5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const straightHigh = uniqueStraight(ranks);

  if (flush && straightHigh) {
    const ranksOut = [straightHigh];
    return { value: pack(CAT.STRAIGHT_FLUSH, ranksOut), category: CAT.STRAIGHT_FLUSH, ranks: ranksOut };
  }
  if (groups[0][1] === 4) {
    const ranksOut = [groups[0][0], groups[1][0]];
    return { value: pack(CAT.QUADS, ranksOut), category: CAT.QUADS, ranks: ranksOut };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    const ranksOut = [groups[0][0], groups[1][0]];
    return { value: pack(CAT.FULL_HOUSE, ranksOut), category: CAT.FULL_HOUSE, ranks: ranksOut };
  }
  if (flush) {
    return { value: pack(CAT.FLUSH, ranks), category: CAT.FLUSH, ranks };
  }
  if (straightHigh) {
    const ranksOut = [straightHigh];
    return { value: pack(CAT.STRAIGHT, ranksOut), category: CAT.STRAIGHT, ranks: ranksOut };
  }
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map((g) => g[0]);
    const ranksOut = [groups[0][0], ...kickers];
    return { value: pack(CAT.TRIPS, ranksOut), category: CAT.TRIPS, ranks: ranksOut };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const ranksOut = [highPair, lowPair, groups[2][0]];
    return { value: pack(CAT.TWO_PAIR, ranksOut), category: CAT.TWO_PAIR, ranks: ranksOut };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map((g) => g[0]);
    const ranksOut = [groups[0][0], ...kickers];
    return { value: pack(CAT.PAIR, ranksOut), category: CAT.PAIR, ranks: ranksOut };
  }
  return { value: pack(CAT.HIGH, ranks), category: CAT.HIGH, ranks };
}

export function evaluateBest(cards: Card[]): HandScore {
  if (cards.length === 5) return evaluate5(cards);
  if (cards.length === 6) {
    let best = evaluate5(cards.slice(0, 5));
    for (let skip = 0; skip < 6; skip++) {
      const five = cards.filter((_, i) => i !== skip);
      const score = evaluate5(five);
      if (score.value > best.value) best = score;
    }
    return best;
  }
  let best = evaluate5(cards.slice(0, 5));
  for (const idx of COMBOS5) {
    const five = idx.map((i) => cards[i]);
    const score = evaluate5(five);
    if (score.value > best.value) best = score;
  }
  return best;
}

export const CATEGORY_LABEL: Record<HandCategory, string> = {
  0: "하이카드",
  1: "원페어",
  2: "투페어",
  3: "트리플",
  4: "스트레이트",
  5: "플러시",
  6: "풀하우스",
  7: "쿼즈",
  8: "스트레이트 플러시",
};

export type MadeClass =
  | "air"
  | "weakpair"
  | "midpair"
  | "toppair"
  | "overpair"
  | "twopair"
  | "trips"
  | "straight"
  | "flush"
  | "fullhouse"
  | "nuts";

export interface SpotRead {
  made: MadeClass;
  score: HandScore;
  pairRank: number;
  kicker: number;
  flushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  overcards: number;
  strength: number;
}

function boardRanks(board: Card[]): Rank[] {
  return board.map((c) => c.rank).sort((a, b) => b - a);
}

export function readSpot(hole: [Card, Card], board: Card[]): SpotRead {
  const all = [...hole, ...board];
  const score = board.length >= 3 ? evaluateBest(all) : evaluate5([...hole, { rank: 2, suit: 0 }, { rank: 3, suit: 1 }, { rank: 4, suit: 2 }]);
  const topBoard = board.length ? Math.max(...board.map((c) => c.rank)) : 0;
  const pairRank = score.category === CAT.PAIR || score.category === CAT.TWO_PAIR || score.category === CAT.TRIPS ? score.ranks[0] : 0;
  const kicker = score.ranks[1] ?? 0;

  let made: MadeClass = "air";
  if (score.category >= CAT.STRAIGHT_FLUSH) made = "nuts";
  else if (score.category === CAT.QUADS || score.category === CAT.FULL_HOUSE) made = "fullhouse";
  else if (score.category === CAT.FLUSH) made = "flush";
  else if (score.category === CAT.STRAIGHT) made = "straight";
  else if (score.category === CAT.TRIPS) made = "trips";
  else if (score.category === CAT.TWO_PAIR) made = "twopair";
  else if (score.category === CAT.PAIR) {
    const holePair = hole[0].rank === hole[1].rank;
    if (holePair && hole[0].rank > topBoard) made = "overpair";
    else if (pairRank === topBoard) made = "toppair";
    else if (pairRank >= 10) made = "midpair";
    else made = "weakpair";
  }

  const suits = new Array(4).fill(0);
  for (const c of all) suits[c.suit]++;
  const holeSuits = [hole[0].suit, hole[1].suit];
  const flushDraw =
    board.length >= 3 &&
    board.length < 5 &&
    suits.some((n, s) => n === 4 && holeSuits.includes(s as 0 | 1 | 2 | 3));

  const ranks = [...new Set(all.map((c) => c.rank))].sort((a, b) => b - a);
  if (ranks.includes(14)) ranks.push(1);
  let oesd = false;
  let gutshot = false;
  if (board.length >= 3 && board.length < 5 && score.category < CAT.STRAIGHT) {
    for (let high = 14; high >= 5; high--) {
      const need = [high, high - 1, high - 2, high - 3, high - 4];
      const have = need.filter((r) => ranks.includes(r)).length;
      if (have === 4) {
        const missing = need.find((r) => !ranks.includes(r))!;
        if (missing === high || missing === high - 4) oesd = true;
        else gutshot = true;
      }
    }
  }

  const overcards = board.length
    ? hole.filter((c) => c.rank > topBoard && hole[0].rank !== hole[1].rank).length
    : 0;

  const base: Record<MadeClass, number> = {
    air: 0.08,
    weakpair: 0.28,
    midpair: 0.42,
    toppair: 0.62,
    overpair: 0.72,
    twopair: 0.82,
    trips: 0.88,
    straight: 0.92,
    flush: 0.94,
    fullhouse: 0.98,
    nuts: 1,
  };
  let strength = base[made];
  if (flushDraw) strength = Math.max(strength, 0.36);
  if (oesd) strength = Math.max(strength, 0.34);
  if (gutshot) strength += 0.04;
  if (overcards) strength += 0.03 * overcards;
  strength = Math.min(0.995, strength);

  return { made, score, pairRank, kicker, flushDraw, oesd, gutshot, overcards, strength };
}

export function madeLabel(made: MadeClass): string {
  const map: Record<MadeClass, string> = {
    air: "에어",
    weakpair: "약한 페어",
    midpair: "중간 페어",
    toppair: "탑페어",
    overpair: "오버페어",
    twopair: "투페어",
    trips: "트리플",
    straight: "스트레이트",
    flush: "플러시",
    fullhouse: "풀하우스+",
    nuts: "넛",
  };
  return map[made];
}

export function preflopStrength(hole: [Card, Card]): number {
  return chenStrength100(hole);
}
