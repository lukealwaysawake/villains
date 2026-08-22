import { evaluateBest } from "./handRank";
import { makeDeck } from "./cards";
import { Rng } from "./rng";
import type { Card } from "./types";

function key(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

function remaining(dead: Card[]): Card[] {
  const used = new Set(dead.map(key));
  return makeDeck().filter((c) => !used.has(key(c)));
}

/**
 * Monte Carlo equity vs one random opponent.
 * Same method used by open-source odds tools: deal leftover board + villain hole, compare 7-card ranks.
 */
export function equityVsRandom(
  hole: [Card, Card],
  board: Card[],
  samples = 80,
  seed = "eq",
): number {
  const dead = [...hole, ...board];
  const deck = remaining(dead);
  if (deck.length < 2 + (5 - board.length)) return 0.5;
  const rng = new Rng(`${seed}:${hole[0].rank}${hole[0].suit}${hole[1].rank}${board.length}:${samples}`);
  let wins = 0;
  let ties = 0;
  const need = 5 - board.length;
  for (let i = 0; i < samples; i++) {
    const mix = rng.shuffle(deck);
    const opp: [Card, Card] = [mix[0], mix[1]];
    const rest = mix.slice(2, 2 + need);
    const fullBoard = [...board, ...rest];
    const hero = evaluateBest([...hole, ...fullBoard]).value;
    const vill = evaluateBest([...opp, ...fullBoard]).value;
    if (hero > vill) wins += 1;
    else if (hero === vill) ties += 1;
  }
  return (wins + ties * 0.5) / samples;
}

export function potOdds(toCall: number, pot: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}
