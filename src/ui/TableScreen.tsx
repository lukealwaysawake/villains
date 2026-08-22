import { useEffect, useRef, useState } from "react";
import { applyAction, createFreshPlayers, legalActions, positionFor, potTotal, sizingPresets, startHand, type TableState } from "../engine/game";
import { BB } from "../engine/types";
import { analyzeHand, type ReviewCard } from "../review/analyze";
import { commitHand, type Profile, type Session } from "../state/store";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { decideVillain, delayFor } from "../villains/policy";
import { onHandEnd, sessionStartLines, updateHeroRead, type SpeechEvent } from "../villains/runtime";
import { Avatar, PlayingCard, bb, signedBb } from "./bits";

const SEAT_CLASS = ["s0", "s1", "s2", "s3", "s4", "s5"];

function deal(s: Session): TableState {
  s.handNumber += 1;
  if (s.handNumber > 1) s.button = (s.button + 1) % 6;
  const ids = ["hero", ...s.villainIds];
  const players = createFreshPlayers(ids).map((p) => ({ ...p, stack: s.stacks[p.id] ?? p.stack }));
  return startHand({ players, button: s.button, handNumber: s.handNumber, seed: s.seed });
}

export function TableScreen({
  profile,
  setProfile,
  session,
  setSession,
  onExit,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  session: Session;
  setSession: (s: Session) => void;
  onExit: () => void;
}) {
  const sessionRef = useRef(session);
  const profileRef = useRef(profile);
  sessionRef.current = session;
  profileRef.current = profile;

  const [table, setTable] = useState<TableState | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [speech, setSpeech] = useState<SpeechEvent | null>(null);
  const [badge, setBadge] = useState<ReviewCard | null>(null);
  const [openReview, setOpenReview] = useState(false);
  const [raiseOn, setRaiseOn] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [hudSeat, setHudSeat] = useState<number | null>(null);
  const committed = useRef(0);
  const boot = useRef(false);

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    const next = structuredClone(sessionRef.current);
    const first = deal(next);
    setSession(next);
    setTable(first);
    const lines = sessionStartLines(next.runtimes);
    if (lines[0]) setSpeech(lines[0]);
  }, [setSession]);

  useEffect(() => {
    if (!speech) return;
    const t = setTimeout(() => setSpeech(null), 2400);
    return () => clearTimeout(t);
  }, [speech]);

  useEffect(() => {
    if (!table || table.toAct === null || table.street === "complete") return;
    const actor = table.players[table.toAct];
    if (actor.id === "hero") return;
    const rt = sessionRef.current.runtimes[actor.id];
    const decision = decideVillain(table, rt, profileRef.current.settings.tellDifficulty);
    setThinking(actor.id);
    const wait = delayFor(decision, profileRef.current.settings.animSpeed);
    const t = setTimeout(() => {
      setThinking(null);
      setTable(applyAction(table, decision.type, decision.raiseTo, decision.delayMs));
    }, wait);
    return () => clearTimeout(t);
  }, [table]);

  useEffect(() => {
    if (!table || table.street !== "complete" || !table.result) return;
    if (committed.current === table.handNumber) return;
    committed.current = table.handNumber;
    const review = analyzeHand(table);
    const nextSession = structuredClone(sessionRef.current);
    const nextProfile = structuredClone(profileRef.current);
    for (const id of nextSession.villainIds) updateHeroRead(nextSession.runtimes[id], table);
    const talks = onHandEnd({ state: table, runtimes: nextSession.runtimes, heroFoldStreak: nextSession.heroFoldStreak });
    if (talks[0]) setSpeech(talks[0]);
    commitHand(nextProfile, nextSession, table, review);
    sessionRef.current = nextSession;
    profileRef.current = nextProfile;
    setSession(nextSession);
    setProfile(nextProfile);
    setBadge(review);
    const pause =
      nextProfile.settings.reviewPause === "all" ||
      (nextProfile.settings.reviewPause === "red" && review.severity === "red") ||
      (nextProfile.settings.reviewPause === "yellow" && review.severity !== "green");
    if (pause) setOpenReview(true);
  }, [table, setProfile, setSession]);

  function nextHand() {
    const s = structuredClone(sessionRef.current);
    setBadge(null);
    setOpenReview(false);
    setRaiseOn(false);
    const dealt = deal(s);
    sessionRef.current = s;
    setSession(s);
    setTable(dealt);
  }

  function act(type: "fold" | "check" | "call" | "bet" | "raise" | "allin", to = 0) {
    if (!table) return;
    setRaiseOn(false);
    setTable(applyAction(table, type, to));
  }

  if (!table) return <section className="screen play" />;

  const hero = table.players[0];
  const legal = table.toAct === 0 ? legalActions(table, 0) : null;
  const presets = legal ? sizingPresets(legal) : [];
  const heroTurn = table.toAct === 0 && table.street !== "complete";
  const pot = potTotal(table);

  return (
    <section className="screen play">
      <div className="playtop">
        <div className="left">
          <button className="chip" onClick={onExit}>종료</button>
          <span className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta)}</span>
        </div>
        <div className="right">
          <span className="chip">핸드 #{table.handNumber}</span>
          <span className="chip">리뷰 {profile.reviewQueue.length}</span>
        </div>
      </div>

      <div className="table">
        <div className="felt-ring" />
        <div className="board">
          <div className="board-cards">
            {table.board.map((c, i) => <PlayingCard key={i} card={c} />)}
            {table.board.length === 0 && <div className="muted" style={{ fontSize: 12 }}>프리플랍</div>}
          </div>
          <div className="pot">팟 {bb(pot)}</div>
        </div>

        {table.players.map((p) => {
          const def = p.id === "hero" ? null : VILLAIN_BY_ID[p.id];
          const rt = p.id === "hero" ? null : session.runtimes[p.id];
          const pos = positionFor(table.button, p.seat);
          const showHud = profile.settings.hudMode !== "off" && !!def;
          const full = profile.settings.hudMode === "learn" || hudSeat === p.seat;
          return (
            <div
              key={p.id}
              className={`seat ${SEAT_CLASS[p.seat]} ${table.toAct === p.seat ? "turn" : ""} ${p.folded ? "fold" : ""}`}
              onClick={() => p.id !== "hero" && setHudSeat(hudSeat === p.seat ? null : p.seat)}
            >
              {speech?.villainId === p.id && <div className="bubble">{speech.line}</div>}
              <Avatar id={p.id} />
              <div className="seat-card">
                <div className="nm">{p.id === "hero" ? "나" : def?.name} · {pos}</div>
                <div className="st">{bb(p.stack)}</div>
                {showHud && def && (
                  <div className="hud">
                    {full
                      ? `VPIP${def.baseStats.vpip} PFR${def.baseStats.pfr} 3b${def.baseStats.threeBet} AF${def.baseStats.aggressionFactor}`
                      : `VPIP${def.baseStats.vpip} PFR${def.baseStats.pfr} AF${def.baseStats.aggressionFactor}`}
                  </div>
                )}
                {rt && rt.emotion !== "NORMAL" && <div className="emo">{rt.emotion}</div>}
                {thinking === p.id && <div className="think"><i /><i /><i /></div>}
              </div>
              {p.contributedStreet > 0 && <div className="chip">{bb(p.contributedStreet)}</div>}
            </div>
          );
        })}

        <div className="seat s0" style={{ pointerEvents: "none", bottom: 72 }}>
          <div className="hole">
            {hero.hole && <PlayingCard card={hero.hole[0]} large />}
            {hero.hole && <PlayingCard card={hero.hole[1]} large />}
          </div>
        </div>
      </div>

      {badge && (
        <button className="badge" onClick={() => setOpenReview(true)}>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <i className={`dot ${badge.severity}`} />
            {badge.severity === "green" ? "최적에 근접" : `${badge.street} -${badge.totalLossBb}bb`}
          </span>
          <span className="muted">탭</span>
        </button>
      )}

      {heroTurn && legal && (
        <div className="action">
          <div className="acts">
            <button className="btn fold" disabled={!legal.canFold && !legal.canCheck} onClick={() => act(legal.canCheck ? "check" : "fold")}>
              {legal.canCheck ? "체크" : "폴드"}
            </button>
            <button className="btn call" disabled={!legal.canCall && !legal.canCheck} onClick={() => act(legal.canCall ? "call" : "check")}>
              {legal.canCall ? `콜 ${bb(legal.callAmount)}` : "체크"}
            </button>
            <button
              className="btn raise"
              disabled={!legal.canBet}
              onClick={() => {
                setRaiseOn((v) => !v);
                setRaiseTo(legal.minBet);
              }}
            >
              {legal.callAmount > 0 ? "레이즈" : "벳"}
            </button>
          </div>
          {raiseOn && (
            <>
              <div className="sizes">
                {presets.map((p) => (
                  <button key={p.label} className={raiseTo === p.to ? "on" : ""} onClick={() => setRaiseTo(p.to)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={legal.minBet}
                max={legal.maxRaiseTo}
                step={BB / 2}
                value={raiseTo}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
              />
              <button className="btn primary wide" style={{ marginTop: 8 }} onClick={() => act(legal.callAmount > 0 ? "raise" : "bet", raiseTo)}>
                {bb(raiseTo)} 확인
              </button>
            </>
          )}
        </div>
      )}

      {table.street === "complete" && (
        <button className="btn primary wide" onClick={nextHand}>다음 핸드</button>
      )}

      {openReview && badge && (
        <div className="sheet" onClick={() => setOpenReview(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">L1 리뷰</div>
            <h2 style={{ margin: "8px 0" }}>{badge.headline}</h2>
            <p className="kicker">{badge.body}</p>
            <div className="card" style={{ marginTop: 12 }}>
              <div className="row"><span className="muted">{badge.statLabel}</span><b>{badge.statValue}</b></div>
              <div className="row" style={{ marginTop: 6 }}><span className="muted">착취 EV 손실</span><b className="bad">-{badge.totalLossBb}bb</b></div>
            </div>
            <p className="kicker" style={{ marginTop: 10 }}>{badge.alt}</p>
            <button className="btn primary wide" style={{ marginTop: 14 }} onClick={() => { setOpenReview(false); if (table.street === "complete") nextHand(); }}>
              닫고 계속
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
