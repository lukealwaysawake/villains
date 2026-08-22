import { describeAction, positionFor, potTotal, seatCount, type TableState } from "../engine/game";
import type { Profile, Session } from "../state/store";
import { VILLAIN_BY_ID } from "../villains/catalog";
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
  const streetKo =
    table.street === "preflop" ? "프리플랍" :
    table.street === "flop" ? "플랍" :
    table.street === "turn" ? "턴" :
    table.street === "river" ? "리버" : "쇼다운";

  return (
    <div className={`table live street-${table.street}`}>
      <div className="felt-wood" />
      <div className="felt-ring" />
      <div className="felt-well" />
      <div className="street-flash" key={table.street}>{streetKo}</div>

      <div className="board">
        <div className="board-cards">
          {[0, 1, 2, 3, 4].map((i) => {
            const c = table.board[i];
            if (!c) return <div key={i} className="pcard-slot" />;
            return <PlayingCard key={`${table.handNumber}-${i}-${c.rank}-${c.suit}`} card={c} delay={i * 70} />;
          })}
        </div>
        <div className="pot" key={pot}>
          <ChipStack n={Math.min(5, Math.max(1, Math.round(pot / 200)))} />
          팟 {bb(pot)}
        </div>
        {table.street === "complete" && table.result && (
          <div className="insight win-banner" style={{ marginTop: 8, padding: "8px 10px", minWidth: 160 }}>
            <div className={table.result.heroDelta >= 0 ? "good" : "bad"}>
              {table.result.heroDelta >= 0 ? "이 핸드 +" : "이 핸드 -"}{bb(Math.abs(table.result.heroDelta))}
            </div>
          </div>
        )}
      </div>

      {table.players.map((p) => {
        const def = p.id === "hero" ? null : VILLAIN_BY_ID[p.id];
        const rt = p.id === "hero" ? null : session.runtimes[p.id];
        const pos = positionFor(table.button, p.seat, n);
        const showHud = profile.settings.hudMode !== "off" && !!def;
        const full = profile.settings.hudMode === "learn" || profile.settings.hudMode === "split" || hudSeat === p.seat;
        const last = lastFor(table, p.id);
        const shown = table.result?.shown[p.seat];
        return (
          <div
            key={p.id}
            className={`seat ${visualClass(p.seat, n)} ${table.toAct === p.seat ? "turn" : ""} ${p.folded ? "fold" : ""} ${p.allIn ? "allin" : ""}`}
            onClick={() => p.id !== "hero" && setHudSeat(hudSeat === p.seat ? null : p.seat)}
          >
            {speech?.villainId === p.id && <div className="bubble">{speech.line}</div>}
            {p.seat === table.button && <div className="dealer">D</div>}
            {last && table.street !== "complete" && (
              <div className={`last-act ${last.type}`}>{describeAction(last)}</div>
            )}
            {p.id === "hero" && p.hole && (
              <div className="hole">
                <PlayingCard key={`${table.handNumber}-a`} card={p.hole[0]} large delay={40} />
                <PlayingCard key={`${table.handNumber}-b`} card={p.hole[1]} large delay={110} />
              </div>
            )}
            {p.id !== "hero" && !p.folded && (
              <div className="hole mini">
                {shown ? (
                  <>
                    <PlayingCard card={shown[0]} delay={80} />
                    <PlayingCard card={shown[1]} delay={140} />
                  </>
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
            </div>
            <div className="seat-card">
              <div className="nm">{p.id === "hero" ? "나" : def?.name} · {pos}</div>
              <div className="st">{bb(p.stack)}</div>
              {showHud && def && (
                <div className="tool-chips">
                  <span className="tool-chip">VPIP {def.baseStats.vpip}</span>
                  <span className="tool-chip">PFR {def.baseStats.pfr}</span>
                  {full && <span className="tool-chip">{pos} VPIP {def.positionalStats?.[pos]?.vpip ?? def.baseStats.vpip}</span>}
                  {full && <span className="tool-chip">3b {def.baseStats.threeBet}</span>}
                  <span className="tool-chip">AF {def.baseStats.aggressionFactor}</span>
                </div>
              )}
              {rt && rt.emotion !== "NORMAL" && <div className="emo">{rt.emotion}</div>}
              {thinking === p.id && <div className="orbit" aria-label="생각 중" />}
            </div>
            {p.contributedStreet > 0 && (
              <div className="bet-pile" key={`${p.id}-${p.contributedStreet}`}>
                <ChipStack n={p.contributedStreet >= 400 ? 4 : 2} />
                {bb(p.contributedStreet)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
