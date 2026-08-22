import { useState } from "react";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { signedBb, type Screen } from "./bits";
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
  const life = sessions.reduce((s, x) => s + x.bbDelta, 0);
  const last = profile.lastSession;
  const hs = last?.heroStats;
  const vpip = hs && hs.hands ? Math.round((hs.vpip / hs.hands) * 100) : 0;
  const pfr = hs && hs.hands ? Math.round((hs.pfr / hs.hands) * 100) : 0;

  return (
    <section className="screen">
      <div className="topbar">
        <div className="eyebrow">분석</div>
        <span />
        <button className="btn glass" onClick={() => go("reviews")}>리뷰 {profile.reviewQueue.length}</button>
      </div>
      <div className="grid3">
        <div className="card"><div className="muted">핸드</div><b>{profile.lifetimeHands}</b></div>
        <div className="card"><div className="muted">세션</div><b>{sessions.length}</b></div>
        <div className="card"><div className="muted">손익</div><b className={life >= 0 ? "good" : "bad"}>{signedBb(life)}</b></div>
      </div>
      <div className="sizes" style={{ marginTop: 10 }}>
        <button className={tab === "pattern" ? "on" : ""} onClick={() => setTab("pattern")}>패턴</button>
        <button className={tab === "kibo" ? "on" : ""} onClick={() => setTab("kibo")}>기보</button>
        <button className={tab === "session" ? "on" : ""} onClick={() => setTab("session")}>세션</button>
      </div>
      {tab === "pattern" && (
        <>
          <div className="insight" style={{ marginTop: 12 }}>
            <div className="row"><span className="idx">00</span><b>내 패턴</b></div>
            <p className="kicker">핸드를 치면 노란/빨간 회고가 여기 쌓입니다. 처음부터 열려 있습니다.</p>
            {hs && (
              <div className="kicker" style={{ marginTop: 6 }}>
                최근 세션 VPIP {vpip}% · PFR {pfr}% · 착취 놓침 {last?.missedExploits ?? 0}
              </div>
            )}
            {habits.length === 0 && <p className="kicker">아직 패턴이 없습니다. 테이블에서 몇 핸드만 치면 생깁니다.</p>}
            {habits.map((h) => (
              <div key={h.tag} className="task-row">
                <div style={{ flex: 1 }}>
                  <b>{h.tag}</b>
                  <div className="kicker">
                    {h.count}회 · {signedBb(-h.totalLossBb)}
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
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><span className="idx">01</span><b>기보</b></div>
          <p className="kicker">끝난 핸드가 시간순으로 남습니다.</p>
          {hands.length === 0 && <p className="kicker">아직 기보가 없습니다. 한 핸드만 끝내면 여기에 뜹니다.</p>}
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
              <span className={h.heroDelta >= 0 ? "good" : "bad"}>{signedBb(h.heroDelta)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === "session" && (
        <div className="card" style={{ marginTop: 12 }}>
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
              <span className={s.bbDelta >= 0 ? "good" : "bad"}>{signedBb(s.bbDelta)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
