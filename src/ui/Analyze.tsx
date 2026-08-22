import { useState } from "react";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { Segmented, signedBb, type Screen } from "./bits";
import { formatSignedDollars, sumKnownDollars } from "./money";
import type { Profile } from "../state/store";

type Tab = "pattern" | "kibo" | "session";

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
          <div className="insight">
            <div className="row"><span className="idx">00</span><b>내 패턴</b></div>
            <p className="kicker">노란/빨간 회고가 여기 모입니다.</p>
            {hs && (
              <div className="kicker" style={{ marginTop: 6 }}>
                최근 세션 VPIP {vpip}% · PFR {pfr}% · 착취 놓침 {last?.missedExploits ?? 0}
              </div>
            )}
            {habits.length === 0 && (
              <div className="empty">
                <img src="/brand/mark.jpg" alt="" />
                <p className="kicker">아직 없어요. 핸드 몇 개만 치면 생깁니다.</p>
              </div>
            )}
            {habits.map((h) => (
              <div key={h.tag} className="task-row">
                <div style={{ flex: 1 }}>
                  <b>{h.tag}</b>
                  <div className="kicker">
                    {h.count}회 · 확인 손실 {formatSignedDollars(h.totalLossDollars === undefined ? undefined : -h.totalLossDollars)}
                    {h.villains.length ? " · " + h.villains.map((id) => VILLAIN_BY_ID[id]?.name ?? id).join(", ") : ""}
                  </div>
                  {h.examples[0] && <div className="kicker">{h.examples[0].body}</div>}
                </div>
                <span className="status">{h.count >= 2 ? "습관" : "1회"}</span>
              </div>
            ))}
          </div>
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
