import type { Card } from "./types";

/** Bill Chen's formula from Hold'em Excellence. Higher is stronger. */
export function chenScore(hole: [Card, Card]): number {
  const [hi, lo] = [...hole].sort((a, b) => b.rank - a.rank);
  const face = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = face(hi.rank);
  if (hi.rank === lo.rank) score = Math.max(5, score * 2);
  else {
    if (hi.suit === lo.suit) score += 2;
    const gap = hi.rank - lo.rank - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && hi.rank < 12) score += 1;
  }
  return Math.max(0, Math.round(score));
}

/** Map Chen 0-20 to 0-100 so existing policy thresholds still work. */
export function chenStrength100(hole: [Card, Card]): number {
  return Math.max(0, Math.min(100, chenScore(hole) * 5));
}

/**
 * Percentile of a Chen score across all 1326 starting combos.
 * Lower means stronger: 5 = top 5% of hands.
 */
const PCT_BY_SCORE: number[] = (() => {
  const weight = new Map<number, number>();
  for (let hi = 2; hi <= 14; hi++) {
    for (let lo = 2; lo <= hi; lo++) {
      const add = (score: number, combos: number) => weight.set(score, (weight.get(score) ?? 0) + combos);
      if (hi === lo) {
        add(scoreOf(hi, lo, false, true), 6);
      } else {
        add(scoreOf(hi, lo, true, false), 4);
        add(scoreOf(hi, lo, false, false), 12);
      }
    }
  }
  const total = 1326;
  const table: number[] = [];
  for (let s = 0; s <= 20; s++) {
    let stronger = 0;
    let same = 0;
    for (const [score, w] of weight) {
      if (score > s) stronger += w;
      else if (score === s) same += w;
    }
    table[s] = Math.max(0.5, Math.min(99, ((stronger + same / 2) / total) * 100));
  }
  return table;
})();

function scoreOf(hi: number, lo: number, suited: boolean, pair: boolean): number {
  const face = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = face(hi);
  if (pair) score = Math.max(5, score * 2);
  else {
    if (suited) score += 2;
    const gap = hi - lo - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && hi < 12) score += 1;
  }
  return Math.max(0, Math.round(score));
}

/** Take chenStrength100 (score * 5) and return the hand percentile. */
export function chenPercentile(strength100: number): number {
  const score = Math.max(0, Math.min(20, Math.round(strength100 / 5)));
  return PCT_BY_SCORE[score];
}
