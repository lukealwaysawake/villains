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
