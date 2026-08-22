import { useEffect, useRef, useState } from "react";
import { applyAction, createFreshPlayers, describeAction, legalActions, positionFor, potTotal, seatCount, sizingPresets, startHand, type TableState } from "../engine/game";
import { BB } from "../engine/types";
import { analyzeHand, type ReviewCard } from "../review/analyze";
import { scoreDecision } from "../review/ev";
import { commitHand, isPro, remainingDailyHands, type Profile, type Session } from "../state/store";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { decideVillain, delayFor } from "../villains/policy";
import { maybeSpeak, onHandEnd, sessionStartLines, updateHeroRead, type SpeechEvent } from "../villains/runtime";
import { Avatar, PlayingCard, bb, signedBb } from "./bits";
import { coachLine } from "./coach";

function visualClass(seat: number, n: number): string {
  if (n <= 4) return ["s0", "s1", "s3", "s5"][seat] ?? "s3";
  if (n === 5) return ["s0", "s1", "s2", "s4", "s5"][seat] ?? "s3";
  return ["s0", "s1", "s2", "s3", "s4", "s5"][seat] ?? "s0";
}

function deal(s: Session): TableState {
  s.handNumber += 1;
  if (s.handNumber > 1) s.button = (s.button + 1) % (s.villainIds.length + 1);
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
  const [deep, setDeep] = useState(false);
  const [raiseOn, setRaiseOn] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [hudSeat, setHudSeat] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const committed = useRef(0);
  const boot = useRef(false);
  const heroSince = useRef<number | null>(null);

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    if (remainingDailyHands(profileRef.current) <= 0) {
      setBlocked("오늘 무료 300핸드를 다 썼습니다. 설정에서 Pro를 켜면 무제한입니다.");
      return;
    }
    const next = structuredClone(sessionRef.current);
    const first = deal(next);
    setSession(next);
    setTable(first);
    const lines = sessionStartLines(next.runtimes);
    if (lines[0]) setSpeech(lines[0]);
  }, [setSession]);

  useEffect(() => {
    if (!speech) return;
    const t = setTimeout(() => setSpeech(null), 2600);
    return () => clearTimeout(t);
  }, [speech]);

  useEffect(() => {
    if (!table || table.toAct === null || table.street === "complete") return;
    const actor = table.players[table.toAct];
    if (actor.id === "hero") {
      heroSince.current = Date.now();
      return;
    }
    heroSince.current = null;
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
    if (!table || table.toAct !== 0) return;
    const t = setInterval(() => {
      if (heroSince.current && Date.now() - heroSince.current > 20000) {
        const list = Object.values(sessionRef.current.runtimes);
        const chatter = list[Math.floor(Math.random() * list.length)];
        const s = maybeSpeak(chatter, "HERO_TANK", table.handNumber);
        if (s) setSpeech(s);
        heroSince.current = Date.now();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [table]);

  useEffect(() => {
    if (!table || table.street !== "complete" || !table.result) return;
    if (committed.current === table.handNumber) return;
    committed.current = table.handNumber;
    let review = analyzeHand(table);
    const heroActs = table.actionLog.filter((a) => a.actorId === "hero");
    const last = heroActs[heroActs.length - 1];
    if (last && last.type !== "fold") {
      try {
        const scored = scoreDecision(table, last.type, last.amount, sessionRef.current.runtimes, 6);
        review = {
          ...review,
          totalLossBb: Math.max(review.totalLossBb, scored.lossBb),
          candidates: scored.candidates.map((c) => ({ label: c.label, ev: c.ev })),
          exploitLine: scored.best ? `착취 기준 최적: ${scored.best.label} (${scored.best.ev >= 0 ? "+" : ""}${scored.best.ev.toFixed(1)}bb)` : review.exploitLine,
          severity: Math.max(review.totalLossBb, scored.lossBb) >= 5 ? "red" : Math.max(review.totalLossBb, scored.lossBb) >= 0.8 ? "yellow" : "green",
        };
      } catch {
        /* keep template review */
      }
    }
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
    const force = nextSession.tutorial && !nextProfile.firstReviewDone;
    const pause =
      force ||
      nextProfile.settings.reviewPause === "all" ||
      (nextProfile.settings.reviewPause === "red" && review.severity === "red") ||
      (nextProfile.settings.reviewPause === "yellow" && review.severity !== "green");
    if (force) {
      nextProfile.firstReviewDone = true;
      setProfile(nextProfile);
    }
    if (pause) setOpenReview(true);
  }, [table, setProfile, setSession]);

  function nextHand() {
    if (remainingDailyHands(profileRef.current) <= 0) {
      setBlocked("오늘 무료 핸드를 다 썼습니다.");
      return;
    }
    const s = structuredClone(sessionRef.current);
    setBadge(null);
    setOpenReview(false);
    setDeep(false);
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

  const n = table ? seatCount(table) : 6;
  const hero = table?.players[0];
  const legal = table && table.toAct === 0 ? legalActions(table, 0) : null;
  const presets = legal ? sizingPresets(legal) : [];
  const heroTurn = !!table && table.toAct === 0 && table.street !== "complete";
  const pot = table ? potTotal(table) : 0;
  const coach = table && session.coachOn && heroTurn ? coachLine(table) : null;
  const canL2 = isPro(profile) || session.l2Used < 3;

  const hudText = (id: string, full: boolean) => {
    const def = VILLAIN_BY_ID[id];
    if (!def) return "";
    if (profile.settings.hudMode === "off") return "";
    if (profile.settings.hudMode === "split" || full || profile.settings.hudMode === "learn") {
      return `VPIP${def.baseStats.vpip} PFR${def.baseStats.pfr} 3b${def.baseStats.threeBet} F3${def.baseStats.foldToThreeBet} AF${def.baseStats.aggressionFactor}`;
    }
    return `VPIP${def.baseStats.vpip} PFR${def.baseStats.pfr} AF${def.baseStats.aggressionFactor}`;
  };

  if (blocked) {
    return (
      <section className="screen play">
        <div className="card" style={{ marginTop: 80 }}>
          <b>{blocked}</b>
          <button className="btn primary wide" style={{ marginTop: 12 }} onClick={onExit}>세션 종료</button>
        </div>
      </section>
    );
  }

  if (!table || !hero) return <section className="screen play" />;

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
          {table.street === "complete" && table.result && (
            <div className="board-cards" style={{ marginTop: 6 }}>
              {Object.entries(table.result.shown).slice(0, 3).map(([seat, hole]) => (
                <span key={seat} style={{ display: "flex", gap: 2 }}>
                  <PlayingCard card={hole[0]} />
                  <PlayingCard card={hole[1]} />
                </span>
              ))}
            </div>
          )}
        </div>

        {table.players.map((p) => {
          const def = p.id === "hero" ? null : VILLAIN_BY_ID[p.id];
          const rt = p.id === "hero" ? null : session.runtimes[p.id];
          const pos = positionFor(table.button, p.seat, n);
          const showHud = profile.settings.hudMode !== "off" && !!def;
          const full = profile.settings.hudMode === "learn" || profile.settings.hudMode === "split" || hudSeat === p.seat;
          return (
            <div
              key={p.id}
              className={`seat ${visualClass(p.seat, n)} ${table.toAct === p.seat ? "turn" : ""} ${p.folded ? "fold" : ""}`}
              onClick={() => p.id !== "hero" && setHudSeat(hudSeat === p.seat ? null : p.seat)}
            >
              {speech?.villainId === p.id && <div className="bubble">{speech.line}</div>}
              {p.id === "hero" && hero.hole && (
                <div className="hole">
                  <PlayingCard key={`${table.handNumber}-a`} card={hero.hole[0]} large />
                  <PlayingCard key={`${table.handNumber}-b`} card={hero.hole[1]} large />
                </div>
              )}
              <Avatar id={p.id} />
              <div className="seat-card">
                <div className="nm">{p.id === "hero" ? "나" : def?.name} · {pos}</div>
                <div className="st">{bb(p.stack)}</div>
                {showHud && def && <div className="hud">{hudText(p.id, full)}</div>}
                {rt && rt.emotion !== "NORMAL" && <div className="emo">{rt.emotion}</div>}
                {thinking === p.id && <div className="think"><i /><i /><i /></div>}
              </div>
              {p.contributedStreet > 0 && <div className="chip">{bb(p.contributedStreet)}</div>}
            </div>
          );
        })}
      </div>

      {coach && <div className="toast">{coach}</div>}

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
            <button className="btn fold glass" disabled={!legal.canFold && !legal.canCheck} onClick={() => act(legal.canCheck ? "check" : "fold")}>
              {legal.canCheck ? "체크" : "폴드"}
            </button>
            <button className="btn call glass" disabled={!legal.canCall && !legal.canCheck} onClick={() => act(legal.canCall ? "call" : "check")}>
              {legal.canCall ? `콜 ${bb(legal.callAmount)}` : "체크"}
            </button>
            <button
              className="btn raise launch"
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
              <input type="range" min={legal.minBet} max={legal.maxRaiseTo} step={BB / 2} value={raiseTo} onChange={(e) => setRaiseTo(Number(e.target.value))} />
              <button className="btn launch wide" style={{ marginTop: 8 }} onClick={() => act(legal.callAmount > 0 ? "raise" : "bet", raiseTo)}>
                {bb(raiseTo)} 확인
              </button>
            </>
          )}
        </div>
      )}

      {table.street === "complete" && (
        <button className="btn launch wide" onClick={nextHand}>다음 핸드</button>
      )}

      {openReview && badge && (
        <div className="sheet" onClick={() => setOpenReview(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{deep ? "L2 심층 리뷰" : "L1 리뷰"}</div>
            <h2 style={{ margin: "8px 0" }}>{badge.headline}</h2>
            <p className="kicker">{badge.body}</p>
            <div className="card" style={{ marginTop: 12 }}>
              <div className="row"><span className="muted">{badge.statLabel}</span><b>{badge.statValue}</b></div>
              <div className="row" style={{ marginTop: 6 }}><span className="muted">착취 EV 손실</span><b className="bad">-{badge.totalLossBb}bb</b></div>
            </div>
            {deep && (
              <>
                <div className="card">
                  <b>GTO 기준</b>
                  <p className="kicker">{badge.gtoLine}</p>
                  <b>착취 기준</b>
                  <p className="kicker">{badge.exploitLine}</p>
                </div>
                {badge.candidates?.map((c) => (
                  <div key={c.label} className="row" style={{ marginTop: 6 }}>
                    <span>{c.label}</span>
                    <b>{c.ev >= 0 ? "+" : ""}{c.ev.toFixed(1)}bb</b>
                  </div>
                ))}
                <p className="kicker">이 실수는 이번 세션 {session.reviews.filter((r) => r.headline === badge.headline).length}번째입니다.</p>
              </>
            )}
            <div className="grid2" style={{ marginTop: 12 }}>
              <button
                className="btn"
                disabled={!canL2 && !deep}
                onClick={() => {
                  if (!deep) {
                    const s = structuredClone(sessionRef.current);
                    s.l2Used += 1;
                    sessionRef.current = s;
                    setSession(s);
                  }
                  setDeep((v) => !v);
                }}
              >
                {deep ? "간단히" : canL2 ? "자세히" : "L2 한도"}
              </button>
              <button className="btn primary" onClick={() => { setOpenReview(false); if (table.street === "complete") nextHand(); }}>
                닫고 계속
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="muted" style={{ fontSize: 10, marginTop: 6, textAlign: "center" }}>
        {table.actionLog.slice(-3).map((a) => `${a.actorId === "hero" ? "나" : VILLAIN_BY_ID[a.actorId]?.name ?? a.actorId} ${describeAction(a)}`).join(" · ")}
      </div>
    </section>
  );
}
