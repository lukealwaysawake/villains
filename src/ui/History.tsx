import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Profile, Screen } from "../state/store";

export function History({ profile, go }: { profile: Profile; go: (s: Screen) => void }) {
  const sessions = profile.sessionHistory ?? [];
  const hands = profile.handLog ?? [];
  const habits = [...(profile.habits ?? [])].sort((a, b) => b.totalLossBb - a.totalLossBb);
  const lifeBb = sessions.reduce((s, x) => s + x.bbDelta, 0);
  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn glass" onClick={() => go("home")}>홈</button>
        <div className="eyebrow">플레이 기록</div>
        <span />
      </div>
      <div className="grid3">
        <div className="card"><div className="muted">누적 핸드</div><b>{profile.lifetimeHands}</b></div>
        <div className="card"><div className="muted">세션</div><b>{sessions.length}</b></div>
        <div className="card"><div className="muted">세션 합</div><b className={lifeBb >= 0 ? "good" : "bad"}>{lifeBb >= 0 ? "+$" : "−$"}{Math.abs(lifeBb).toFixed(1)}</b></div>
      </div>
      <div className="insight">
        <div className="row"><span className="idx">00</span><b>내 패턴 분석</b></div>
        <p className="kicker">노란/빨간 회고만 모아 습관으로 쌓습니다. 한 번 뜬 실수도 남고, 두 번 이상이면 습관으로 봅니다.</p>
        {habits.length === 0 && <p className="kicker">아직 나쁜 습관 기록이 없습니다. 핸드를 치면 회고가 여기 쌓입니다.</p>}
        {habits.map((h) => (
          <div key={h.tag} className="task-row">
            <div style={{ flex: 1 }}>
              <b>{h.tag}</b>
              <div className="kicker">
                {h.count}회 · 손실 -${h.totalLossBb.toFixed(1)}
                {h.villains.length ? " · " + h.villains.map((id) => VILLAIN_BY_ID[id]?.name ?? id).join(", ") : ""}
              </div>
              {h.examples[0] && <div className="kicker">{h.examples[0].body}</div>}
            </div>
            <span className="status">{h.count >= 2 ? "습관" : "1회"}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="row"><span className="idx">01</span><b>세션</b></div>
        {sessions.length === 0 && <p className="kicker">테이블을 종료하면 세션이 여기 쌓입니다.</p>}
        {sessions.map((s) => (
          <div key={s.id + String(s.startedAt)} className="task-row">
            <div style={{ flex: 1 }}>
              <b>{new Date(s.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b>
              <div className="kicker">
                {s.handsPlayed}핸드 · {s.villainIds.map((id) => VILLAIN_BY_ID[id]?.name ?? id).join(" · ")}
              </div>
            </div>
            <span className={s.bbDelta >= 0 ? "good" : "bad"}>{s.bbDelta >= 0 ? "+$" : "−$"}{Math.abs(s.bbDelta).toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="row"><span className="idx">02</span><b>최근 핸드</b></div>
        {hands.length === 0 && <p className="kicker">핸드가 끝나면 여기에 남습니다.</p>}
        {hands.slice(0, 40).map((h) => (
          <div key={String(h.at) + "-" + h.handNumber} className="task-row">
            <div style={{ flex: 1 }}>
              <b>#{h.handNumber} {h.headline}</b>
              <div className="kicker">{new Date(h.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <span className={h.heroDelta >= 0 ? "good" : "bad"}>{h.heroDelta >= 0 ? "+" : ""}{h.heroDelta.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
