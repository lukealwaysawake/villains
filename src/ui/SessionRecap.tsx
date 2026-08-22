import { useState } from "react";
import { sessionPatterns, type Profile, type Session } from "../state/store";
import { displayReviewCopy } from "../review/analyze";
import { primaryDecisionAnalysis } from "../review/coaching";
import { scoreLabel, summarizeSession as summarizeCoachingSession } from "../review/learning";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { Avatar, signedBb, type Screen } from "./bits";
import { DecisionCoachCard } from "./DecisionCoachCard";

export function SessionRecap({
  session,
  profile,
  go,
}: {
  session: Session;
  profile: Profile;
  go: (s: Screen) => void;
}) {
  const [showAllHands, setShowAllHands] = useState(false);
  const hs = session.heroStats;
  const hands = Math.max(1, hs.hands);
  const vpip = Math.round((hs.vpip / hands) * 100);
  const pfr = Math.round((hs.pfr / hands) * 100);
  const three = hs.threeBetOpp ? Math.round((hs.threeBet / hs.threeBetOpp) * 100) : 0;
  const wtsd = hs.sawFlop ? Math.round((hs.wtsd / hs.sawFlop) * 100) : 0;
  const reviews = [...(session.reviews ?? [])].reverse();
  const analyses = reviews.flatMap((review) => review.analyses ?? []);
  const coaching = summarizeCoachingSession(analyses);
  const pendingCount = reviews.filter((review) => review.analysisStatus === "preliminary").length;
  const bestDecision = [...analyses].filter((analysis) => analysis.overallScore >= 80).sort((left, right) => right.overallScore - left.overallScore)[0];
  const patternMap = new Map<string, { count: number; misses: number; loss: number; analysis: typeof analyses[number] }>();
  for (const analysis of analyses) {
    const item = patternMap.get(analysis.patternId) ?? { count: 0, misses: 0, loss: 0, analysis };
    const loss = Math.max(analysis.baselineLossBb, analysis.exploitLossBb ?? 0);
    item.count += 1;
    item.misses += loss >= 0.8 || (analysis.exploitScore !== undefined && analysis.exploitScore < 80) ? 1 : 0;
    item.loss += loss;
    if (analysis.overallScore < item.analysis.overallScore) item.analysis = analysis;
    patternMap.set(analysis.patternId, item);
  }
  const coachingPatterns = [...patternMap.values()].filter((pattern) => pattern.misses > 0).sort((left, right) => right.loss - left.loss).slice(0, 2);
  const misses = reviews.filter((r) => r.severity !== "green");
  const patterns = sessionPatterns(session);
  const kibos = (profile.handLog ?? []).filter((h) => h.sessionId === session.id);
  const showExtraKibos = kibos.length > 0 && kibos.length !== reviews.length;
  const visibleReviews = (showAllHands ? reviews : reviews.filter((review) => review.severity !== "green")).slice(0, 10);

  return (
    <section className="screen recap no-nav">
      <div className="eyebrow">SESSION RECAP</div>
      <h1 className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta, session.room?.bb)}</h1>
      <p className="kicker">
        {session.handsPlayed}핸드 · {session.room ? `$${session.room.sb}/$${session.room.bb}` : "캐시"} · {session.villainIds.map((id) => VILLAIN_BY_ID[id]?.name).join(" · ")}
      </p>
      {coaching.hasData && (
        <div className="session-coaching card" aria-label={`세션 코칭 점수 ${Math.round(coaching.overallScore)}점, ${scoreLabel(coaching.overallScore)}`}>
          <div className="session-score"><strong>{Math.round(coaching.overallScore)}</strong><span>점</span></div>
          <div>
            <span className="eyebrow">COACHING SCORE</span>
            <h2>{scoreLabel(coaching.overallScore)} · 결정 {coaching.decisionCount}개</h2>
            <p>기본기 {Math.round(coaching.fundamentalsScore)}점{coaching.exploitScore === undefined ? " · 착취 기회 없음" : ` · 상대 맞춤 ${Math.round(coaching.exploitScore)}점`}</p>
          </div>
        </div>
      )}
      {pendingCount > 0 && <p className="analysis-pending" role="status">빠른 분석은 완료됐습니다. {pendingCount}핸드의 정밀 EV 비교가 계속 계산 중입니다.</p>}
      {bestDecision && (
        <div className="session-win insight">
          <span className="eyebrow">잘한 결정</span>
          <b>{bestDecision.guidance.judgment}</b>
          <p>{bestDecision.guidance.evidence[0]}</p>
        </div>
      )}
      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="card"><div className="muted">VPIP</div><b>{vpip}%</b></div>
        <div className="card"><div className="muted">PFR</div><b>{pfr}%</b></div>
        <div className="card"><div className="muted">3B</div><b>{three}%</b></div>
      </div>
      <div className="grid3">
        <div className="card"><div className="muted">WTSD</div><b>{wtsd}%</b></div>
        <div className="card"><div className="muted">착취 놓침</div><b>{session.missedExploits ?? 0}</b></div>
        <div className="card"><div className="muted">실수 핸드</div><b>{misses.length}</b></div>
      </div>

      <div className="insight" style={{ marginTop: 12 }}>
        <div className="row"><span className="idx">01</span><b>다음 세션 우선 교정</b></div>
        {coachingPatterns.length === 0 && patterns.length === 0 && <p className="kicker">반복해서 교정할 결정은 아직 없습니다.</p>}
        {coachingPatterns.map((pattern) => (
          <div key={pattern.analysis.patternId} className="priority-row">
            <div className="row"><b>{pattern.analysis.guidance.judgment}</b><span>{pattern.misses}/{pattern.count} 놓침</span></div>
            <p>{pattern.analysis.guidance.nextRule.condition} {pattern.analysis.guidance.nextRule.action}</p>
            <small>누적 추정 손실 {pattern.loss.toFixed(1)}bb · 다음 10번 중 2회 이하 목표</small>
          </div>
        ))}
        {coachingPatterns.length === 0 && patterns.map((pattern) => (
          <div key={pattern.tag} className="task-row"><div style={{ flex: 1 }}><b>{pattern.tag}</b><div className="kicker">{pattern.count}회 · {signedBb(-pattern.loss, session.room?.bb)}</div></div></div>
        ))}
      </div>

      <div className="card">
        <div className="row"><span className="idx">02</span><b>핸드 복기</b><button className="text-link" onClick={() => setShowAllHands((value) => !value)}>{showAllHands ? "교정만" : "전체"}</button></div>
        {reviews.length === 0 && <p className="kicker">이 세션에 끝난 핸드가 없습니다.</p>}
        {visibleReviews.length === 0 && reviews.length > 0 && <p className="kicker">교정이 필요한 핸드가 없습니다. 전체를 누르면 좋은 결정도 볼 수 있어요.</p>}
        {visibleReviews.map((r) => {
          const copy = displayReviewCopy(r);
          const analysis = primaryDecisionAnalysis(r.analyses ?? []);
          const best = r.decision?.best ?? r.candidates?.[0];
          const status = r.severity !== "green" && r.totalLossBb > 0
            ? signedBb(-r.totalLossBb, session.room?.bb)
            : r.decision
              ? r.decision.lossBb === 0
                ? "BEST"
                : `Δ${signedBb(r.decision.lossBb, session.room?.bb).replace("+", "")}`
              : best ? "EV" : "OK";
          return (
            <details key={r.id} className="hand-block">
              <summary>
                <i className={`dot ${r.severity}`} />
                <span className="hb-title">#{r.handNumber} {copy.headline}</span>
                <span className={r.severity !== "green" ? "bad" : "muted"}>{status}</span>
              </summary>
              <p className="kicker">{copy.body}</p>
              {analysis && <DecisionCoachCard analysis={analysis} status={r.analysisStatus ?? "final"} compact />}
              {r.decision && (
                <div className="recap-decision" aria-label="핵심 결정 EV 비교">
                  <span><small>내 선택</small><b>{r.decision.played.label}</b><em>{signedBb(r.decision.played.ev, session.room?.bb)}</em></span>
                  <span><small>최고 후보</small><b>{r.decision.best.label}</b><em>{signedBb(r.decision.best.ev, session.room?.bb)}</em></span>
                </div>
              )}
              {!r.decision && best && (
                <div className="recap-best">
                  <small>저장된 후보 중 최고 EV</small><b>{best.label}</b><em>{signedBb(best.ev, session.room?.bb)}</em>
                </div>
              )}
              {r.streets && r.streets.length > 0 && (
                <div className="street-rows">
                  {r.streets.map((s) => (
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
            </details>
          );
        })}
      </div>

      {showExtraKibos && (
        <div className="card">
          <div className="row"><span className="idx">03</span><b>기보</b></div>
          {kibos.map((h) => (
            <div key={String(h.at) + h.handNumber} className="task-row">
              <div style={{ flex: 1 }}><b>#{h.handNumber} {h.headline}</b></div>
              <span className={h.heroDelta >= 0 ? "good" : "bad"}>{signedBb(h.heroDelta, session.room?.bb)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row"><span className="idx">{showExtraKibos ? "04" : "03"}</span><b>상대</b></div>
        {session.villainIds.map((id) => (
          <div key={id} className="list-item">
            <Avatar id={id} />
            <b>{VILLAIN_BY_ID[id]?.name ?? id}</b>
          </div>
        ))}
      </div>

      <div className="button-pair recap-actions">
        <button className="btn glass" onClick={() => go("analyze")}>전체 분석</button>
        <button className="btn primary" onClick={() => go("home")}>홈으로</button>
      </div>
    </section>
  );
}
