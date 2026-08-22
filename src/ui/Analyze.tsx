import { useState } from "react";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { Segmented, signedBb, type Screen } from "./bits";
import { formatSignedDollars, sumKnownDollars } from "./money";
import { skillScore, type Profile } from "../state/store";
import { habitStatus, scoreLabel, summarizeSession as summarizeCoachingSession, type HabitStatus, type SkillKey } from "../review/learning";

type Tab = "pattern" | "kibo" | "session";

const SKILL_LABEL: Record<SkillKey, string> = {
  preflop: "프리플랍",
  position: "포지션",
  pot_odds: "팟 오즈",
  aggression: "공격 빈도",
  sizing: "사이징",
  street_plan: "스트리트 계획",
  stack_awareness: "스택 인식",
  opponent_exploit: "상대 맞춤",
};

const HABIT_LABEL: Record<HabitStatus, string> = {
  observing: "관찰 중",
  signal: "징후",
  confirmed: "확정",
  improving: "개선 중",
  resolved: "해결",
};

export function Analyze({
  profile,
  go,
}: {
  profile: Profile;
  go: (s: Screen) => void;
}) {
  const [tab, setTab] = useState<Tab>("pattern");
  const sessions = profile.sessionHistory ?? [];
  const hands = profile.handLog ?? [];
  const habits = [...(profile.habits ?? [])].sort((a, b) => b.totalLossBb - a.totalLossBb || b.count - a.count);
  const life = sumKnownDollars(sessions);
  const lifeValue = life.tracked > 0 || sessions.length === 0 ? life.value : undefined;
  const last = profile.lastSession;
  const hs = last?.heroStats;
  const vpip = hs && hs.hands ? Math.round((hs.vpip / hs.hands) * 100) : 0;
  const pfr = hs && hs.hands ? Math.round((hs.pfr / hs.hands) * 100) : 0;
  const recentDecisions = profile.learning.recentDecisions ?? [];
  const coaching = summarizeCoachingSession(recentDecisions);
  const learningPatterns = Object.values(profile.learning.patterns)
    .map((pattern) => ({
      pattern,
      status: habitStatus(pattern),
      analysis: [...recentDecisions].reverse().find((analysis) => analysis.patternId === pattern.patternId),
    }))
    .sort((left, right) => {
      const weight: Record<HabitStatus, number> = { confirmed: 5, signal: 4, improving: 3, observing: 2, resolved: 1 };
      return weight[right.status] - weight[left.status] || right.pattern.totalLossBb - left.pattern.totalLossBb;
    })
    .slice(0, 12);
  const primaryPattern = learningPatterns.find(({ status, analysis }) => !!analysis && (status === "confirmed" || status === "signal" || status === "improving"));
  const skills = (Object.entries(SKILL_LABEL) as Array<[SkillKey, string]>).map(([skill, label]) => ({
    skill,
    label,
    aggregate: profile.learning.skills[skill],
    score: skillScore(profile.learning.skills[skill]),
  }));

  return (
    <section className="screen">
      <div className="page-title records-title">
        <div className="row"><span className="eyebrow">RECORDS</span><button className="btn glass compact" onClick={() => go("reviews")}>리뷰 {profile.reviewQueue.length}</button></div>
        <h1>플레이 기록</h1>
        <p>반복되는 결정 패턴과 세션 결과를 한곳에서 확인하세요.</p>
      </div>
      <div className="grid3">
        <div className="card"><div className="muted">핸드</div><b>{profile.lifetimeHands}</b></div>
        <div className="card"><div className="muted">세션</div><b>{sessions.length}</b></div>
        <div className="card"><div className="muted">{life.complete ? "손익" : "확인된 손익"}</div><b className={(lifeValue ?? 0) >= 0 ? "good" : "bad"}>{formatSignedDollars(lifeValue)}</b></div>
      </div>
      <Segmented
        label="기록 보기"
        value={tab}
        options={[
          { value: "pattern", label: "패턴" },
          { value: "kibo", label: "기보" },
          { value: "session", label: "세션" },
        ]}
        onChange={setTab}
        columns={3}
        className="records-tabs"
      />
      {tab === "pattern" && (
        <>
          <div className="coaching-overview insight">
            <div className="row"><span className="idx">00</span><b>장기 코칭</b></div>
            {coaching.hasData ? (
              <div className="coaching-overview-score">
                <strong>{Math.round(coaching.overallScore)}</strong>
                <span><b>{scoreLabel(coaching.overallScore)}</b><small>분석된 결정 {coaching.decisionCount}개</small></span>
              </div>
            ) : <p className="kicker">아직 분석된 결정이 없습니다.</p>}
            {hs && (
              <div className="kicker" style={{ marginTop: 6 }}>
                최근 세션 VPIP {vpip}% · PFR {pfr}% · 착취 놓침 {last?.missedExploits ?? 0}
              </div>
            )}
          </div>
          {primaryPattern?.analysis && (
            <div className="next-focus card">
              <span className="eyebrow">다음 테이블 한 가지</span>
              <b>{primaryPattern.analysis.guidance.nextRule.condition}</b>
              <p>{primaryPattern.analysis.guidance.nextRule.action}</p>
              <small>{HABIT_LABEL[primaryPattern.status]} · {primaryPattern.pattern.misses}/{primaryPattern.pattern.opportunities} 놓침 · {primaryPattern.pattern.totalLossBb.toFixed(1)}bb</small>
            </div>
          )}
          <div className="card skill-card">
            <div className="row"><span className="idx">01</span><b>8개 기술 영역</b></div>
            {skills.map(({ skill, label, aggregate, score }) => (
              <div key={skill} className="skill-row">
                <span><b>{label}</b><small>{aggregate ? `기회 ${aggregate.opportunities}회 · 놓침 ${aggregate.misses}회` : "표본 없음"}</small></span>
                {score === undefined ? <em>관찰 중</em> : <em className={score < 65 ? "bad" : score < 80 ? "warn" : "good"}>{score}점</em>}
                <div className="skill-meter" role="progressbar" aria-label={`${label} ${score === undefined ? "관찰 중" : `${score}점`}`} aria-valuemin={0} aria-valuemax={100} {...(score === undefined ? {} : { "aria-valuenow": score })}><i style={{ width: `${score ?? 0}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="card pattern-card">
            <div className="row"><span className="idx">02</span><b>기회 기반 패턴</b></div>
            <p className="kicker">한 번의 결과가 아니라 같은 기회에서 반복되는 선택으로 판단합니다.</p>
            {learningPatterns.length === 0 && <div className="empty"><img src="/brand/mark.jpg" alt="" /><p className="kicker">같은 상황이 3번 이상 쌓이면 징후를 알려드려요.</p></div>}
            {learningPatterns.map(({ pattern, status, analysis }) => (
              <div key={pattern.patternId} className="pattern-row">
                <div className="row"><b>{analysis?.guidance.judgment ?? SKILL_LABEL[pattern.skill]}</b><span className={`habit-${status}`}>{HABIT_LABEL[status]}</span></div>
                <p>{pattern.opportunities}번 중 {pattern.misses}번 놓침 · 누적 {pattern.totalLossBb.toFixed(1)}bb</p>
                {analysis && <small>{analysis.guidance.nextRule.condition} {analysis.guidance.nextRule.action}</small>}
              </div>
            ))}
          </div>
          {habits.length > 0 && (
            <details className="card legacy-patterns">
              <summary>이전 버전 기록 {habits.length}개 <span>과거 참고 · 낮은 신뢰도</span></summary>
              {habits.map((habit) => (
                <div key={habit.tag} className="task-row"><div style={{ flex: 1 }}><b>{habit.tag}</b><div className="kicker">{habit.count}회 · 확인 손실 {formatSignedDollars(habit.totalLossDollars === undefined ? undefined : -habit.totalLossDollars)}</div></div></div>
              ))}
            </details>
          )}
        </>
      )}
      {tab === "kibo" && (
        <div className="card">
          <div className="row"><span className="idx">01</span><b>기보</b></div>
          <p className="kicker">끝난 핸드가 시간순으로 남습니다.</p>
          {hands.length === 0 && <p className="kicker">아직 없어요. 핸드 하나 끝내면 뜹니다.</p>}
          {hands.slice(0, 80).map((h) => (
            <div key={String(h.at) + "-" + h.handNumber} className="task-row">
              <div style={{ flex: 1 }}>
                <b>#{h.handNumber} {h.headline}</b>
                <div className="kicker">
                  {new Date(h.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {h.villainId ? " · " + (VILLAIN_BY_ID[h.villainId]?.name ?? h.villainId) : ""}
                  {h.leak ? " · " + h.leak : ""}
                </div>
              </div>
              <span className={h.heroDelta >= 0 ? "good" : "bad"}>{signedBb(h.heroDelta, h.bigBlindDollars)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === "session" && (
        <div className="card">
          <div className="row"><span className="idx">02</span><b>세션</b></div>
          {sessions.length === 0 && <p className="kicker">테이블을 종료하면 세션이 쌓입니다.</p>}
          {sessions.map((s) => (
            <div key={s.id + String(s.startedAt)} className="task-row">
              <div style={{ flex: 1 }}>
                <b>{new Date(s.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b>
                <div className="kicker">
                  {s.handsPlayed}핸드 · VPIP {s.vpip}% · PFR {s.pfr}%
                  <br />
                  {s.villainIds.map((id) => VILLAIN_BY_ID[id]?.name ?? id).join(" · ")}
                </div>
              </div>
              <span className={s.bbDelta >= 0 ? "good" : "bad"}>{signedBb(s.bbDelta, s.bigBlindDollars)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
