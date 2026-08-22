import { useEffect, useRef, useState } from "react";
import { applyAction, createFreshPlayers, legalActions, sizingPresets, startHand, type TableState } from "../engine/game";
import { BB } from "../engine/types";
import { analyzeHand, type ReviewCard } from "../review/analyze";
import { scoreDecisionAsync } from "../review/evClient";
import { commitHand, persistLive, remainingDailyHands, type Profile, type Session } from "../state/store";
import { decideVillain, delayFor } from "../villains/policy";
import { maybeSpeak, onHandEnd, sessionStartLines, updateHeroRead, type SpeechEvent } from "../villains/runtime";
import { FeltTable } from "./FeltTable";
import { bb, signedBb } from "./bits";
import { coachLine } from "./coach";

function deal(s: Session): TableState {
  s.handNumber += 1;
  if (s.handNumber > 1) s.button = (s.button + 1) % (s.villainIds.length + 1);
  const room = s.room;
  const buyIn = s.buyInChips ?? Math.round((room?.startStack ?? 100) * 100);
  const sb = Math.round((room?.sb ?? 0.5) * 100);
  const bbChip = Math.round((room?.bb ?? 1) * 100);
  const limit = room?.buyInLimit ?? 0;
  const ids = ["hero", ...s.villainIds];
  const players = createFreshPlayers(ids, buyIn).map((p) => {
    let stack = s.stacks[p.id] ?? buyIn;
    if (stack < bbChip) {
      if (p.id === "hero") {
        const used = s.heroBuyIns ?? 1;
        if (room?.autoRebuy !== false && (limit === 0 || used < limit)) {
          s.heroBuyIns = used + 1;
          stack = buyIn;
        }
      } else if (room?.autoRebuy !== false) {
        stack = buyIn;
      }
    }
    return { ...p, stack };
  });
  return startHand({
    players,
    button: s.button,
    handNumber: s.handNumber,
    seed: s.seed,
    buyIn,
    autoRebuy: false,
    sb,
    bb: bbChip,
  });
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
    if (next.liveTable) {
      setSession(next);
      setTable(next.liveTable);
      if (next.liveTable.street === "complete") committed.current = next.liveTable.handNumber;
    } else {
      const first = deal(next);
      next.liveTable = first;
      setSession(next);
      setTable(first);
      persistLive(profileRef.current, next, first);
      const lines = sessionStartLines(next.runtimes);
      if (lines[0]) setSpeech(lines[0]);
    }
  }, [setSession]);

  useEffect(() => {
    if (!table) return;
    const s = sessionRef.current;
    s.liveTable = table;
    persistLive(profileRef.current, s, table);
  }, [table]);

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
    if (last && last.type !== "fold") {
      void scoreDecisionAsync({
        state: table,
        runtimes: nextSession.runtimes,
        heroType: last.type,
        heroRaiseTo: last.amount,
        samples: 24,
        tell: nextProfile.settings.tellDifficulty,
      }).then((scored) => {
        if (!scored) return;
        setBadge((cur) => {
          if (!cur || cur.handNumber !== review.handNumber) return cur;
          const loss = Math.max(cur.totalLossBb, scored.lossBb);
          return {
            ...cur,
            totalLossBb: loss,
            candidates: scored.candidates.map((c) => ({ label: c.label, ev: c.ev })),
            exploitLine: scored.best ? "착취 기준 최적: " + scored.best.label : cur.exploitLine,
            severity: loss >= 5 ? "red" : loss >= 0.8 ? "yellow" : "green",
          };
        });
      });
    }
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
    const room = sessionRef.current.room;
    const bbChip = Math.round((room?.bb ?? 1) * 100);
    const limit = room?.buyInLimit ?? 0;
    const used = sessionRef.current.heroBuyIns ?? 1;
    const heroStack = sessionRef.current.stacks.hero ?? 0;
    if (heroStack < bbChip && (room?.autoRebuy === false || (limit > 0 && used >= limit))) {
      setBlocked("바이인이 소진됐습니다. 세션을 종료합니다.");
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

  const hero = table?.players[0];
  const legal = table && table.toAct === 0 ? legalActions(table, 0) : null;
  const presets = legal ? sizingPresets(legal) : [];
  const heroTurn = !!table && table.toAct === 0 && table.street !== "complete";
  const tutorialOn = session.tutorial && session.handsPlayed < 30;
  const coach = table && (session.coachOn || tutorialOn) && heroTurn ? coachLine(table) : null;
  const canL2 = true;


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
      <div className="playhud">
        <button className="hud-exit" onClick={onExit}>종료</button>
        <b className="hud-stakes">{session.room ? `${session.room.sb ?? 0.5}/${session.room.bb ?? 1}` : "캐시"}</b>
        <span className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta)}</span>
        <span className="hud-hand">#{table.handNumber}</span>
      </div>

      <FeltTable
        table={table}
        session={session}
        profile={profile}
        thinking={thinking}
        speech={speech}
        hudSeat={hudSeat}
        setHudSeat={setHudSeat}
      />

      {coach && <div className="toast">{coach}</div>}

      {badge && table.street !== "complete" && (
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
              {legal.callAmount > 0 ? "레이즈" : "벳"} {bb(legal.minBet)}+
            </button>
          </div>
          {legal.canCall && legal.callAmount > 0 && (
            <div className="odds-line">팟오즈 {Math.round((legal.callAmount / (legal.pot + legal.callAmount)) * 100)}%</div>
          )}
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

      {!heroTurn && table.street !== "complete" && (
        <div className="waitbar">
          <i className="orbit" />
          <span>{thinking ? "생각 중" : "진행 중"}</span>
        </div>
      )}

      {table.street === "complete" && (
        <div className="endbar">
          {badge && (
            <button className="end-rev" onClick={() => setOpenReview(true)}>
              <i className={`dot ${badge.severity}`} />
              <span>{badge.headline}</span>
            </button>
          )}
          <button className="btn launch wide" onClick={nextHand}>다음 핸드</button>
        </div>
      )}

      {openReview && badge && (
        <div className="sheet revsheet" onClick={() => setOpenReview(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="row"><span className="eyebrow">{deep ? "심층" : "복기"}</span><span className="muted">{badge.statValue}</span></div>
            <div className="reco tight">
              <b>{badge.headline}</b>
              <p>{badge.body}</p>
              <div className="conf">-{badge.totalLossBb}bb</div>
            </div>
            {badge.streets && badge.streets.length > 0 && (
              <div className="street-rows">
                {badge.streets.map((s) => (
                  <div key={s.street} className="street-row">
                    <b>{s.label}</b>
                    <span className="sr-board">{s.board}</span>
                    <span className="sr-made">{s.made}</span>
                    <span className="sr-act">{s.actions}</span>
                    <span className="sr-note">{s.note}</span>
                  </div>
                ))}
              </div>
            )}
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
            <div className="grid2" style={{ marginTop: 8 }}>
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
              <button className="btn launch" onClick={() => { setOpenReview(false); if (table.street === "complete") nextHand(); }}>
                닫고 계속
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
