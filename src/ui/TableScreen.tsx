import { useEffect, useRef, useState } from "react";
import { applyAction, createFreshPlayers, legalActions, sizingPresets, startHand, type TableState } from "../engine/game";
import { analyzeHand, type ReviewCard } from "../review/analyze";
import { scoreDecisionAsync } from "../review/evClient";
import { commitHand, persistLive, type Profile, type Session } from "../state/store";
import { decideVillain, delayFor } from "../villains/policy";
import { maybeSpeak, onHandEnd, sessionStartLines, updateHeroRead, type SpeechEvent } from "../villains/runtime";
import { VILLAIN_BY_ID } from "../villains/catalog";
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
  const [exitOpen, setExitOpen] = useState(false);
  const [hudSeat, setHudSeat] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const committed = useRef(0);
  const boot = useRef(false);
  const heroSince = useRef<number | null>(null);

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
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
          const severity = loss >= 5 ? "red" : loss >= 0.8 ? "yellow" : "green";
          const wasReclassified = cur.severity === "green" && severity !== "green";
          return {
            ...cur,
            totalLossBb: loss,
            candidates: scored.candidates.map((c) => ({ label: c.label, ev: c.ev })),
            exploitLine: scored.best ? "착취 기준 최적: " + scored.best.label : cur.exploitLine,
            severity,
            headline: wasReclassified && scored.best ? `${scored.best.label}가 더 나은 결정` : cur.headline,
            body: wasReclassified && scored.best ? `간이 EV 비교에서 ${scored.best.label}의 기대값이 더 높았습니다.` : cur.body,
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
  const hasDeepReview = !!badge && !!(badge.gtoLine || badge.exploitLine || badge.candidates?.length);
  const actingName = table?.toAct === null || table?.toAct === undefined
    ? null
    : table.players[table.toAct]?.id === "hero"
      ? "나"
      : VILLAIN_BY_ID[table.players[table.toAct]?.id]?.name ?? "상대";

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
        <button className="hud-exit" onClick={() => setExitOpen(true)} aria-label="세션 종료 메뉴">종료</button>
        <b className="hud-stakes">{session.room ? `$${session.room.sb ?? 0.5}/$${session.room.bb ?? 1}` : "캐시"}</b>
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
            {badge.severity === "green" ? "최적에 근접" : `${badge.street} -$${badge.totalLossBb}`}
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
          {badge && (
            <button className="end-rev" onClick={() => setOpenReview(true)}>
              <i className={`dot ${badge.severity}`} aria-hidden="true" />
              <span><b>리뷰 보기</b><small>{badge.headline}</small></span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          )}
          <button className="btn primary wide" onClick={nextHand}>다음 핸드</button>
        </div>
      )}

      {openReview && badge && (
        <div className="sheet revsheet" role="dialog" aria-modal="true" aria-label="핸드 복기" onClick={() => setOpenReview(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="review-scroll">
            <div className="row"><span className="eyebrow">{deep ? "상세 복기" : "핸드 복기"}</span><span className="muted">{badge.statValue}</span></div>
            <div className={`reco tight ${badge.severity}`}>
              <div className="review-kicker"><i className={`dot ${badge.severity}`} aria-hidden="true" />{badge.severity === "green" ? "좋은 결정" : badge.severity === "yellow" ? "확인할 결정" : "큰 손실 결정"}</div>
              <b>{badge.headline}</b>
              <p>{badge.body}</p>
              <div className="conf">{badge.totalLossBb > 0 ? `손실 $${badge.totalLossBb}` : "추정 손실 없음"}</div>
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
                {badge.gtoLine && <div><b>기본 전략</b><p>{badge.gtoLine}</p></div>}
                {badge.exploitLine && <div><b>상대 맞춤 전략</b><p>{badge.exploitLine}</p></div>}
                {badge.candidates && badge.candidates.length > 0 && (
                  <div className="candidate-list">
                    {badge.candidates.map((candidate) => <span key={candidate.label}><b>{candidate.label}</b><em>{candidate.ev >= 0 ? "+$" : "−$"}{Math.abs(candidate.ev).toFixed(1)}</em></span>)}
                  </div>
                )}
                {badge.totalLossBb > 0 && <p className="repeat-note">이번 세션에서 같은 유형이 {session.reviews.filter((review) => review.headline === badge.headline).length}번 나왔습니다.</p>}
              </div>
            )}
            </div>
            <div className="review-actions">
              <button className="btn glass" disabled={!hasDeepReview} onClick={() => setDeep((value) => !value)}>{deep ? "간단히 보기" : "자세히 보기"}</button>
              <button className="btn primary" onClick={() => { setOpenReview(false); if (table.street === "complete") nextHand(); }}>
                {table.street === "complete" ? "다음 핸드" : "테이블로"}
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
