import { useEffect, useRef, useState } from "react";
import { applyAction, cloneState, continueHand, legalActions, positionFor, sizingPresets, type TableState } from "../engine/game";
import { analyzeHand, mergeDecisionScores, type ReviewCard } from "../review/analyze";
import type { DecisionSnapshot } from "../review/ev";
import { scoreDecisionsAsync } from "../review/evClient";
import { canContinueSession, commitHand, dealNext, persistLive, type Profile, type Session } from "../state/store";
import { decideVillain, delayFor } from "../villains/policy";
import { maybeSpeak, onHandEnd, sessionStartLines, updateHeroRead, type SpeechEvent } from "../villains/runtime";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { FeltTable } from "./FeltTable";
import { bb, signedBb } from "./bits";
import { coachLine } from "./coach";

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
  const [exitOpen, setExitOpen] = useState(false);
  const [hudSeat, setHudSeat] = useState<number | null>(null);
  const [showPositions, setShowPositions] = useState(false);
  const [sessionOver, setSessionOver] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const committed = useRef(0);
  const boot = useRef(false);
  const heroSince = useRef<number | null>(null);

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    const next = structuredClone(sessionRef.current);
    next.pendingDecisions ??= [];
    if (next.liveTable) {
      setSession(next);
      setTable(next.liveTable);
      if (next.liveTable.street === "complete") {
        const savedReview = [...(next.reviews ?? [])].reverse().find((item) => item.handNumber === next.liveTable?.handNumber);
        if (savedReview) {
          committed.current = next.liveTable.handNumber;
          setBadge(savedReview);
          setShowPositions(true);
          setOpenReview(false);
          const cont = canContinueSession(next);
          setSessionOver(cont.ok ? null : cont.reason);
        }
      }
    } else {
      const first = dealNext(next);
      next.pendingDecisions = [];
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
    if (!table || table.street === "complete" || table.street === "showdown") return;
    if (table.toAct === null) {
      setTable(continueHand(table));
      return;
    }
    const actor = table.players[table.toAct];
    if (!actor || actor.folded || actor.allIn) {
      setTable(continueHand(table));
      return;
    }
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
    setFinalizing(true);
    setFinalizeError(null);
    const completedTable = table;
    const nextSession = structuredClone(sessionRef.current);
    const nextProfile = structuredClone(profileRef.current);
    const decisions = nextSession.pendingDecisions ?? [];

    async function finishHand() {
      let review = analyzeHand(completedTable);
      try {
        const sampleCount = Math.max(16, Math.min(32, Math.floor(128 / Math.max(1, decisions.length))));
        let scores = await scoreDecisionsAsync({
          decisions,
          samples: sampleCount,
          tell: nextProfile.settings.tellDifficulty,
        });
        if (!scores && decisions.length > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const { scoreDecisions } = await import("../review/ev");
          scores = scoreDecisions(decisions, 12, nextProfile.settings.tellDifficulty);
        }
        if (scores) review = mergeDecisionScores(review, scores);
      } catch {
        // The deterministic rule review remains a safe fallback if the worker fails.
      }

      nextSession.pendingDecisions = [];
      for (const player of completedTable.players) {
        if (player.id !== "hero") updateHeroRead(nextSession.runtimes[player.id], completedTable);
      }
      const talks = onHandEnd({ state: completedTable, runtimes: nextSession.runtimes, heroFoldStreak: nextSession.heroFoldStreak });
      const force = nextSession.tutorial && !nextProfile.firstReviewDone;
      if (force) nextProfile.firstReviewDone = true;
      commitHand(nextProfile, nextSession, completedTable, review);

      sessionRef.current = nextSession;
      profileRef.current = nextProfile;
      setSession(nextSession);
      setProfile(nextProfile);
      setBadge(review);
      if (talks[0]) setSpeech(talks[0]);
      const cont = canContinueSession(nextSession);
      setSessionOver(cont.ok ? null : cont.reason);
      setShowPositions(true);
      setOpenReview(false);
      setFinalizing(false);
    }

    void finishHand().catch(() => {
      setFinalizing(false);
      setFinalizeError("핸드 기록을 저장하지 못했습니다. 새로고침하면 다시 시도합니다.");
    });
  }, [table, setProfile, setSession]);

  function nextHand() {
    const cont = canContinueSession(sessionRef.current);
    if (!cont.ok) {
      setSessionOver(cont.reason);
      onExit();
      return;
    }
    const s = structuredClone(sessionRef.current);
    s.pendingDecisions = [];
    setBadge(null);
    setOpenReview(false);
    setShowPositions(false);
    setSessionOver(null);
    setDeep(false);
    setRaiseOn(false);
    const dealt = dealNext(s);
    sessionRef.current = s;
    setSession(s);
    setTable(dealt);
  }

  function act(type: "fold" | "check" | "call" | "bet" | "raise" | "allin", to = 0) {
    if (!table) return;
    const decision: DecisionSnapshot = {
      snapshot: cloneState(table),
      runtimes: structuredClone(sessionRef.current.runtimes),
      heroType: type,
      heroRaiseTo: to,
    };
    const nextSession = structuredClone(sessionRef.current);
    nextSession.pendingDecisions = [...(nextSession.pendingDecisions ?? []), decision];
    sessionRef.current = nextSession;
    setSession(nextSession);
    setRaiseOn(false);
    setTable(applyAction(table, type, to));
  }

  const hero = table?.players[0];
  const legal = table && table.toAct === 0 ? legalActions(table, 0) : null;
  const presets = legal ? sizingPresets(legal) : [];
  const heroTurn = !!table && table.toAct === 0 && table.street !== "complete" && !table.players[0]?.folded && !table.players[0]?.allIn;
  const tutorialOn = session.tutorial && session.handsPlayed < 30;
  const coach = table && (session.coachOn || tutorialOn) && heroTurn ? coachLine(table) : null;
  const hasDeepReview = !!badge && !!(badge.gtoLine || badge.exploitLine || badge.candidates?.length);
  const actingName = table?.toAct === null || table?.toAct === undefined
    ? null
    : table.players[table.toAct]?.id === "hero"
      ? "나"
      : VILLAIN_BY_ID[table.players[table.toAct]?.id]?.name ?? "상대";
  const winnerSeats = new Set((table?.result?.winnersByPot ?? []).flatMap((pot) => pot.seats));
  const positionRows = table?.players.map((player) => ({
    id: player.id,
    name: player.id === "hero" ? "나" : VILLAIN_BY_ID[player.id]?.name ?? player.id,
    position: positionFor(table.button, player.seat, table.players.length),
    status: winnerSeats.has(player.seat) ? "승리" : player.folded ? "폴드" : player.allIn ? "올인" : "쇼다운",
  })) ?? [];

  if (!table || !hero) return <section className="screen play" />;

  return (
    <section className="screen play">
      <div className="playhud">
        <button className="hud-exit" disabled={finalizing} onClick={() => setExitOpen(true)} aria-label="세션 종료 메뉴">종료</button>
        <span className="hud-blinds" aria-label={`스몰 블라인드 $${session.room?.sb ?? 0.5}, 빅 블라인드 $${session.room?.bb ?? 1}`}>
          <span><i>SB</i><b>${session.room?.sb ?? 0.5}</b></span>
          <span><i>BB</i><b>${session.room?.bb ?? 1}</b></span>
        </span>
        <span className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta, session.room?.bb)}</span>
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
            {badge.severity === "green" ? "최적에 근접" : `${badge.street} ${signedBb(-badge.totalLossBb, session.room?.bb)}`}
          </span>
          <span className="muted">탭</span>
        </button>
      )}

      {heroTurn && legal && (
        <div className="action" aria-label="플레이 액션">
          {raiseOn && (
            <div className="raise-tray">
              <div className="raise-head"><span>{legal.callAmount > 0 ? "레이즈 금액" : "베팅 금액"}</span><b>{bb(raiseTo)}</b></div>
              <div className="sizes">
                {presets.filter((preset) => preset.label !== "올인").map((preset) => (
                  <button key={preset.label} className={raiseTo === preset.to ? "on" : ""} aria-pressed={raiseTo === preset.to} onClick={() => setRaiseTo(preset.to)}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <input aria-label="베팅 금액" type="range" min={legal.minBet} max={legal.maxRaiseTo} step={Math.max(1, table.bb / 2)} value={raiseTo} onChange={(e) => setRaiseTo(Number(e.target.value))} />
              <div className="raise-confirm">
                <button className="btn ghost" onClick={() => setRaiseOn(false)}>취소</button>
                <button className="btn primary" onClick={() => act(legal.callAmount > 0 ? "raise" : "bet", raiseTo)}>{bb(raiseTo)}로 확정</button>
              </div>
            </div>
          )}
          <div className="acts acts-four">
            <button className="action-button fold" disabled={!legal.canFold} onClick={() => act("fold")}>
              <span>폴드</span><small>{legal.canFold ? "포기" : "불가"}</small>
            </button>
            <button className="action-button call" disabled={!legal.canCall && !legal.canCheck} onClick={() => act(legal.canCall ? "call" : "check")}>
              <span>{legal.canCall ? `콜 ${bb(legal.callAmount)}` : "체크"}</span>
              <small>{legal.canCall ? `팟오즈 ${Math.round((legal.callAmount / (legal.pot + legal.callAmount)) * 100)}%` : "넘기기"}</small>
            </button>
            <button
              className={`action-button raise ${raiseOn ? "on" : ""}`}
              disabled={!legal.canBet}
              aria-expanded={raiseOn}
              onClick={() => {
                setRaiseOn((value) => !value);
                setRaiseTo(legal.minBet);
              }}
            >
              <span>{legal.callAmount > 0 ? `레이즈 ${bb(legal.minBet)}+` : `벳 ${bb(legal.minBet)}+`}</span><small>금액 선택</small>
            </button>
            <button className="action-button allin" disabled={!legal.canBet} onClick={() => act("allin", legal.maxRaiseTo)}>
              <span>올인</span><small>전부</small>
            </button>
          </div>
        </div>
      )}

      {!heroTurn && table.street !== "complete" && (
        <div className="waitbar" aria-live="polite">
          <i className="orbit" aria-hidden="true" />
          <span>{actingName ? `${actingName} ${thinking ? "생각 중" : "차례"}` : "핸드가 진행 중입니다"}</span>
        </div>
      )}

      {table.street === "complete" && (
        <div className="endbar">
          {finalizing && (
            <div className="end-rev" role="status" aria-live="polite">
              <span>결정별 EV 분석 중</span>
            </div>
          )}
          {finalizeError && <p className="session-over" role="alert">{finalizeError}</p>}
          {sessionOver && <p className="session-over" role="status">{sessionOver}</p>}
          {badge && (
            <button className="end-rev" onClick={() => setShowPositions(true)}>
              <i className={`dot ${badge.severity}`} aria-hidden="true" />
              <span><b>완료 요약 보기</b><small>{badge.headline}</small></span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          )}
        </div>
      )}

      {showPositions && badge && table.street === "complete" && (
        <div className="sheet positionsheet" role="dialog" aria-modal="true" aria-labelledby="hand-complete-title">
          <div className="panel">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="row">
              <div><span className="eyebrow">HAND COMPLETE</span><h2 id="hand-complete-title">#{table.handNumber} 포지션</h2></div>
              {sessionOver && <span className="bad">세션 종료</span>}
            </div>
            <div className="position-roster">
              {positionRows.map((player) => (
                <div key={player.id} className={player.status === "승리" ? "winner" : player.status === "폴드" ? "folded" : ""}>
                  <span>{player.name}</span><b>{player.position}</b><small>{player.status}</small>
                </div>
              ))}
            </div>
            {sessionOver && <p className="position-note">{sessionOver} 이 핸드를 복기하면 세션 결과로 이동합니다.</p>}
            <button className="btn primary wide position-review" onClick={() => { setShowPositions(false); setOpenReview(true); }}>
              핸드 리뷰 보기
            </button>
          </div>
        </div>
      )}

      {openReview && badge && (
        <div className="sheet revsheet" role="dialog" aria-modal="true" aria-label="핸드 복기">
          <div className="panel">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="review-scroll">
            <div className="row"><span className="eyebrow">{deep ? "상세 복기" : "핸드 복기"}</span><span className="muted">{badge.statValue}</span></div>
            <div className={`reco tight ${badge.severity}`}>
              <div className="review-kicker"><i className={`dot ${badge.severity}`} aria-hidden="true" />{badge.severity === "green" ? "좋은 결정" : badge.severity === "yellow" ? "확인할 결정" : "큰 손실 결정"}</div>
              <b>{badge.headline}</b>
              <p>{badge.body}</p>
              <div className="conf">{badge.totalLossBb > 0 ? `손실 ${signedBb(-badge.totalLossBb, session.room?.bb).replace("−", "")}` : "추정 손실 없음"}</div>
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
            {deep && hasDeepReview && (
              <div className="deep-review">
                {badge.gtoLine && <div><b>EV 표본 기준</b><p>{badge.gtoLine}</p></div>}
                {badge.exploitLine && <div><b>상대 맞춤 전략</b><p>{badge.exploitLine}</p></div>}
                {badge.candidates && badge.candidates.length > 0 && (
                  <div className="candidate-list">
                    {badge.candidates.map((candidate) => <span key={candidate.label}><b>{candidate.label}</b><em>{signedBb(candidate.ev, session.room?.bb)}</em></span>)}
                  </div>
                )}
                {badge.totalLossBb > 0 && <p className="repeat-note">이번 세션에서 같은 유형이 {session.reviews.filter((review) => review.headline === badge.headline).length}번 나왔습니다.</p>}
              </div>
            )}
            </div>
            <div className="review-actions">
              <button className="btn glass" disabled={!hasDeepReview} onClick={() => setDeep((value) => !value)}>{deep ? "간단히 보기" : "자세히 보기"}</button>
              <button className="btn primary" onClick={() => { setOpenReview(false); if (table.street === "complete") nextHand(); }}>
                {table.street === "complete" ? sessionOver ? "세션 끝내기" : "다음 핸드" : "테이블로"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitOpen && (
        <div className="sheet exit-sheet" role="dialog" aria-modal="true" aria-label="세션 종료 확인" onClick={() => setExitOpen(false)}>
          <div className="panel" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <span className="eyebrow">SESSION</span>
            <h2>테이블을 나갈까요?</h2>
            <p>현재까지의 핸드와 분석 기록은 저장됩니다. 진행 중인 핸드는 이어서 칠 수 없어요.</p>
            <div className="review-actions">
              <button className="btn glass" onClick={() => setExitOpen(false)}>계속 플레이</button>
              <button className="btn danger" onClick={onExit}>세션 종료</button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
