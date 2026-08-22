import { useEffect, useRef, useState } from "react";
import { describeAction, positionFor, potTotal, seatCount, type TableState } from "../engine/game";
import { madeLabel, readSpot } from "../engine/handRank";
import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Profile, Session } from "../state/store";
import type { SpeechEvent } from "../villains/runtime";
import { Avatar, ChipStack, PlayingCard, bb } from "./bits";

function visualClass(seat: number, n: number): string {
  if (n <= 4) return ["s0", "s1", "s3", "s5"][seat] ?? "s3";
  if (n === 5) return ["s0", "s1", "s2", "s4", "s5"][seat] ?? "s3";
  return ["s0", "s1", "s2", "s3", "s4", "s5"][seat] ?? "s0";
}

function lastFor(table: TableState, id: string) {
  return [...table.actionLog].reverse().find((a) => a.actorId === id);
}

function actorName(id: string): string {
  return id === "hero" ? "나" : VILLAIN_BY_ID[id]?.name ?? id;
}

function emotionLabel(emotion: string): string {
  const labels: Record<string, string> = { TILT: "흔들림", SCARED: "위축", CONFIDENT: "자신감", STEAMING: "과열" };
  return labels[emotion] ?? "";
}

export function FeltTable({
  table,
  session,
  profile,
  thinking,
  speech,
  hudSeat,
  setHudSeat,
}: {
  table: TableState;
  session: Session;
  profile: Profile;
  thinking: string | null;
  speech: SpeechEvent | null;
  hudSeat: number | null;
  setHudSeat: (n: number | null) => void;
}) {
  const n = seatCount(table);
  const pot = potTotal(table);
  const last = table.actionLog[table.actionLog.length - 1];
  const [splash, setSplash] = useState<{ key: number; text: string; kind: string } | null>(null);
  const [collect, setCollect] = useState(false);
  const streetRef = useRef(table.street);

  useEffect(() => {
    if (!last) return;
    if (last.type === "fold" || last.type === "check") return;
    setSplash({ key: table.actionLog.length, text: describeAction(last), kind: last.type });
    const t = setTimeout(() => setSplash(null), 720);
    return () => clearTimeout(t);
  }, [table.actionLog.length, last]);

  useEffect(() => {
    if (streetRef.current !== table.street && table.street !== "preflop") {
      setCollect(true);
      const t = setTimeout(() => setCollect(false), 460);
      streetRef.current = table.street;
      return () => clearTimeout(t);
    }
    streetRef.current = table.street;
  }, [table.street]);

  const hero = table.players[0];
  const heroRead = hero.hole && table.board.length >= 3 ? readSpot(hero.hole, table.board) : null;
  const winners = new Set((table.result?.winnersByPot ?? []).flatMap((w) => w.seats));
  const done = table.street === "complete" && !!table.result;
  const wonBySeat: Record<number, number> = {};
  for (const w of table.result?.winnersByPot ?? []) {
    const share = w.amount / Math.max(1, w.seats.length);
    for (const s of w.seats) wonBySeat[s] = (wonBySeat[s] ?? 0) + share;
  }

  return (
    <div className={`table live street-${table.street} ${collect ? "collecting" : ""}`}>
      <div className="felt-wood" />
      <div className="felt-ring" />
      <div className="felt-well" />
      {splash && (
        <div className={`splash ${splash.kind}`} key={splash.key}>
          {splash.kind === "allin" ? "ALL IN" : splash.text}
        </div>
      )}

      <div className="board">
        <div className="board-cards">
          {[0, 1, 2, 3, 4].map((i) => {
            const c = table.board[i];
            if (!c) return <div key={i} className="pcard-slot" />;
            const delay = table.street === "flop" ? i * 90 : i * 40;
            return <PlayingCard key={`${table.handNumber}-${i}-${c.rank}-${c.suit}`} card={c} delay={delay} />;
          })}
        </div>
        <div className={`pot ${collect ? "suck" : ""} ${done ? "away" : ""}`} key={`${table.handNumber}-${table.street}-${pot}`}>
          <ChipStack n={Math.min(5, Math.max(1, Math.round(pot / 200)))} />
          <div>
            <div className="pot-lab">POT</div>
            <b>{bb(pot)}</b>
          </div>
        </div>
        {table.street === "complete" && table.result && (
          <div className={`win-pill ${table.result.heroDelta >= 0 ? "win" : "lose"}`}>
            {table.result.heroDelta >= 0 ? "+" : "-"}{bb(Math.abs(table.result.heroDelta))}
          </div>
        )}
      </div>

      {table.players.map((p) => {
        const def = p.id === "hero" ? null : VILLAIN_BY_ID[p.id];
        const rt = p.id === "hero" ? null : session.runtimes[p.id];
        const pos = positionFor(table.button, p.seat, n);
        const showHud = profile.settings.hudMode !== "off" && !!def;
        const full = hudSeat === p.seat || profile.settings.hudMode === "learn";
        const act = lastFor(table, p.id);
        const shown = table.result?.shown[p.seat];
        const won = winners.has(p.seat);
        const seatName = p.id === "hero" ? "나" : def?.name ?? p.id;
        const seatLabel = `${seatName}, ${pos}, 스택 ${bb(p.stack)}${act ? `, 최근 ${describeAction(act)}` : ""}`;
        const toggleHud = () => p.id !== "hero" && setHudSeat(hudSeat === p.seat ? null : p.seat);
        return (
          <div
            key={p.id}
            className={`seat ${visualClass(p.seat, n)} ${table.toAct === p.seat ? "turn" : ""} ${p.folded ? "fold" : ""} ${p.allIn ? "allin" : ""} ${won ? "winner" : ""}`}
            role={p.id !== "hero" ? "button" : undefined}
            tabIndex={p.id !== "hero" ? 0 : undefined}
            aria-label={seatLabel}
            aria-pressed={p.id !== "hero" ? hudSeat === p.seat : undefined}
            onClick={toggleHud}
            onKeyDown={(event) => { if (p.id !== "hero" && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleHud(); } }}
          >
            {speech?.villainId === p.id && <div className="bubble" aria-live="polite">{speech.line}</div>}
            {p.seat === table.button && <div className="dealer">D</div>}
            {act && table.street !== "complete" && (
              <div className={`last-act ${act.type}`}>{describeAction(act)}</div>
            )}
            {p.id === "hero" && p.hole && (
              <div className="hole hero-hole">
                <PlayingCard key={`${table.handNumber}-a`} card={p.hole[0]} large delay={40} />
                <PlayingCard key={`${table.handNumber}-b`} card={p.hole[1]} large delay={120} />
                {heroRead && !p.folded && table.street !== "complete" && (
                  <span className="hero-made">{madeLabel(heroRead.made)}</span>
                )}
              </div>
            )}
            {p.id !== "hero" && (
              <div className={`hole mini ${p.folded ? "muck" : ""}`}>
                {shown ? (
                  <>
                    <PlayingCard card={shown[0]} delay={90} />
                    <PlayingCard card={shown[1]} delay={160} />
                  </>
                ) : p.folded ? (
                  <div className="muck-tag">MUCK</div>
                ) : (
                  <>
                    <PlayingCard hidden delay={30} />
                    <PlayingCard hidden delay={80} />
                  </>
                )}
              </div>
            )}
            <div className="seat-ava">
              <Avatar id={p.id} />
              {table.toAct === p.seat && <i className="timer" />}
              {won && <i className="win-burst" />}
              {done && won && (
                <div className="award" key={`aw-${table.handNumber}`}>
                  <ChipStack n={5} />
                </div>
              )}
              {done && wonBySeat[p.seat] > 0 && (
                <div className="award-amt" key={`amt-${table.handNumber}`}>+{bb(wonBySeat[p.seat])}</div>
              )}
            </div>
            <div className="seat-card">
              <div className="nm">{p.id === "hero" ? "나" : def?.name} · {pos}</div>
              <div className={`st ${done && won ? "pop" : ""}`}>{bb(p.stack)}</div>
              {showHud && def && (
                <div className="tool-chips">
                  <span className="tool-chip">VPIP {def.baseStats.vpip}</span>
                  <span className="tool-chip">PFR {def.baseStats.pfr}</span>
                  {full && <span className="tool-chip">AF {def.baseStats.aggressionFactor}</span>}
                  {full && <span className="tool-chip">{pos} {def.positionalStats?.[pos]?.vpip ?? def.baseStats.vpip}</span>}
                </div>
              )}
              {rt && rt.emotion !== "NORMAL" && <div className="emo">{emotionLabel(rt.emotion)}</div>}
              {thinking === p.id && <div className="orbit" aria-label="생각 중" />}
            </div>
            {p.contributedStreet > 0 && (
              <div className={`bet-pile ${collect ? "to-pot" : ""}`} key={`${p.id}-${p.contributedStreet}-${table.street}`}>
                <ChipStack n={p.contributedStreet >= 400 ? 4 : 2} />
                {bb(p.contributedStreet)}
              </div>
            )}
          </div>
        );
      })}

      {table.toAct !== null && table.toAct !== 0 && table.street !== "complete" && (
        <div className="turn-cue" role="status" aria-live="polite">{actorName(table.players[table.toAct].id)} 차례</div>
      )}

      <div className="ticker" aria-hidden="true">
        {table.actionLog.slice(-4).map((a, i) => (
          <span key={`${a.actorId}-${a.street}-${i}`}>{actorName(a.actorId)} {describeAction(a)}</span>
        ))}
      </div>
    </div>
  );
}
