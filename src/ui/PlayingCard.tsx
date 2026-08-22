import type { Card } from "../engine/types";
import { RANK_GLYPH, SUIT_GLYPH, isRed } from "../engine/cards";

const PIPS: Record<number, [number, number][]> = {
  14: [[50, 50]],
  2: [[50, 20], [50, 80]],
  3: [[50, 18], [50, 50], [50, 82]],
  4: [[28, 22], [72, 22], [28, 78], [72, 78]],
  5: [[28, 22], [72, 22], [50, 50], [28, 78], [72, 78]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
  7: [[28, 20], [72, 20], [50, 36], [28, 50], [72, 50], [28, 80], [72, 80]],
  8: [[28, 18], [72, 18], [28, 39], [72, 39], [28, 61], [72, 61], [28, 82], [72, 82]],
  9: [[28, 16], [72, 16], [28, 38], [72, 38], [50, 50], [28, 62], [72, 62], [28, 84], [72, 84]],
  10: [[28, 15], [72, 15], [50, 28], [28, 38], [72, 38], [28, 62], [72, 62], [50, 72], [28, 85], [72, 85]],
};

const SUIT_COLOR = ["#141414", "#c0392b", "#1d6fb8", "#17824a"];

export function PlayingCard({
  card,
  hidden,
  large,
  delay = 0,
  flip = true,
}: {
  card?: Card | null;
  hidden?: boolean;
  large?: boolean;
  delay?: number;
  flip?: boolean;
}) {
  const showBack = hidden || !card;
  const color = card ? SUIT_COLOR[card.suit] : "#141414";
  const court = !!card && card.rank >= 11;
  const pips = card && !court ? PIPS[card.rank] ?? PIPS[14] : [];
  return (
    <div
      className={`pcard-3d ${large ? "lg" : ""} ${flip && !showBack ? "flip" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="pcard-inner">
        <div className="pcard-face pcard-back" aria-hidden="true">
          <i />
        </div>
        <div className={`pcard-face pcard-front ${card && isRed(card) ? "red" : ""}`} style={{ color }}>
          {card && (
            <>
              <b className="idx tl">{RANK_GLYPH[card.rank]}<em>{SUIT_GLYPH[card.suit]}</em></b>
              <b className="idx br">{RANK_GLYPH[card.rank]}<em>{SUIT_GLYPH[card.suit]}</em></b>
              {court ? (
                <div className="court">{RANK_GLYPH[card.rank]}</div>
              ) : (
                <div className="pips">
                  {pips.map(([x, y], i) => (
                    <span key={i} style={{ left: `${x}%`, top: `${y}%` }}>{SUIT_GLYPH[card.suit]}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChipStack({ n = 3 }: { n?: number }) {
  const count = Math.max(1, Math.min(5, n));
  return (
    <span className="chip-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ bottom: i * 3 }} />)}
    </span>
  );
}
