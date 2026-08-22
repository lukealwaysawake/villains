import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Profile, Screen } from "../state/store";

export function History({ profile, go }: { profile: Profile; go: (s: Screen) => void }) {
  const sessions = profile.sessionHistory ?? [];
  const hands = profile.handLog ?? [];
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
        <div className="card"><div className="muted">세션 합</div><b className={lifeBb >= 0 ? "good" : "bad"}>{lifeBb >= 0 ? "+" : ""}{lifeBb.toFixed(1)}</b></div>
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
            <span className={s.bbDelta >= 0 ? "good" : "bad"}>{s.bbDelta >= 0 ? "+" : ""}{s.bbDelta.toFixed(1)}</span>
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
