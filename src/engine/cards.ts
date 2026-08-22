import type { Card, Rank, Suit } from "./types";
import { Rng } from "./rng";

export const SUIT_GLYPH = ["♠", "♥", "♦", "♣"] as const;
export const SUIT_NAME = ["s", "h", "d", "c"] as const;
export const RANK_GLYPH: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

/** Card faces show 10; poker notation stays T (T9s). */
export const FACE_GLYPH: Record<Rank, string> = { ...RANK_GLYPH, 10: "10" };

export function cardKey(card: Card): string {
  return `${RANK_GLYPH[card.rank]}${SUIT_NAME[card.suit]}`;
}

export function formatCard(card: Card): string {
  return `${RANK_GLYPH[card.rank]}${SUIT_GLYPH[card.suit]}`;
}

export function isRed(card: Card): boolean {
  return card.suit === 1 || card.suit === 2;
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) {
      deck.push({ rank: r as Rank, suit: s as Suit });
    }
  }
  return deck;
}

export function shuffleDeck(rng: Rng): Card[] {
  return rng.shuffle(makeDeck());
}

export function parseCard(text: string): Card {
  const rankChar = text[0].toUpperCase();
  const suitChar = text[1].toLowerCase();
  const rankMap: Record<string, Rank> = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  };
  const suitMap: Record<string, Suit> = { s: 0, h: 1, d: 2, c: 3 };
  return { rank: rankMap[rankChar], suit: suitMap[suitChar] };
}

export function holeLabel(hole: [Card, Card]): string {
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank);
  const suited = a.suit === b.suit;
  if (a.rank === b.rank) return `${RANK_GLYPH[a.rank]}${RANK_GLYPH[b.rank]}`;
  return `${RANK_GLYPH[a.rank]}${RANK_GLYPH[b.rank]}${suited ? "s" : "o"}`;
}
