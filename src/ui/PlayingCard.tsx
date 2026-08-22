import type { Card } from "../engine/types";
import { FACE_GLYPH, SUIT_GLYPH, isRed } from "../engine/cards";

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
  const label = showBack ? "카드 뒷면" : `${FACE_GLYPH[card!.rank]}${SUIT_GLYPH[card!.suit]}`;
  return (
    <div
      className={`pcard-3d ${large ? "lg" : ""} ${flip && !showBack ? "flip" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
      role="img"
      aria-label={label}
    >
      <div className="pcard-inner">
        <div className="pcard-face pcard-back" aria-hidden="true">
          <i />
        </div>
        <div className={`pcard-face pcard-front ${card && isRed(card) ? "red" : ""}`} style={{ color }}>
          {card && (
            <>
              <b className="idx tl">{FACE_GLYPH[card.rank]}<em>{SUIT_GLYPH[card.suit]}</em></b>
              <b className="idx br">{FACE_GLYPH[card.rank]}<em>{SUIT_GLYPH[card.suit]}</em></b>
              <div className="court">{FACE_GLYPH[card.rank]}</div>
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
