import { sessionPatterns, type Profile, type Session } from "../state/store";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { Avatar, signedBb, type Screen } from "./bits";

export function SessionRecap({
  session,
  profile,
  go,
}: {
  session: Session;
  profile: Profile;
  go: (s: Screen) => void;
}) {
  const hs = session.heroStats;
  const hands = Math.max(1, hs.hands);
  const vpip = Math.round((hs.vpip / hands) * 100);
  const pfr = Math.round((hs.pfr / hands) * 100);
  const three = hs.threeBetOpp ? Math.round((hs.threeBet / hs.threeBetOpp) * 100) : 0;
  const wtsd = hs.sawFlop ? Math.round((hs.wtsd / hs.sawFlop) * 100) : 0;
  const reviews = [...(session.reviews ?? [])].reverse();
  const misses = reviews.filter((r) => r.severity !== "green");
  const patterns = sessionPatterns(session);
  const kibos = (profile.handLog ?? []).filter((h) => h.sessionId === session.id);
  const showExtraKibos = kibos.length > 0 && kibos.length !== reviews.length;

  return (
    <section className="screen recap no-nav">
      <div className="eyebrow">SESSION RECAP</div>
      <h1 className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta)}</h1>
      <p className="kicker">
        {session.handsPlayed}핸드 · {session.room ? `$${session.room.sb}/$${session.room.bb}` : "캐시"} · {session.villainIds.map((id) => VILLAIN_BY_ID[id]?.name).join(" · ")}
      </p>
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
        <div className="row"><span className="idx">01</span><b>이번 세션 패턴</b></div>
        {patterns.length === 0 && <p className="kicker">반복된 실수는 없습니다.</p>}
        {patterns.map((p) => (
          <div key={p.tag} className="task-row">
            <div style={{ flex: 1 }}>
              <b>{p.tag}</b>
              <div className="kicker">{p.count}회 · -${p.loss.toFixed(1)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row"><span className="idx">02</span><b>핸드 복기</b></div>
        {reviews.length === 0 && <p className="kicker">이 세션에 끝난 핸드가 없습니다.</p>}
        {reviews.map((r) => (
          <details key={r.id} className="hand-block">
            <summary>
              <i className={`dot ${r.severity}`} />
              <span className="hb-title">#{r.handNumber} {r.headline}</span>
              <span className={r.totalLossBb > 0 ? "bad" : "muted"}>{r.totalLossBb > 0 ? `-$${r.totalLossBb}` : "OK"}</span>
            </summary>
            <p className="kicker">{r.body}</p>
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
        ))}
      </div>

      {showExtraKibos && (
        <div className="card">
          <div className="row"><span className="idx">03</span><b>기보</b></div>
          {kibos.map((h) => (
            <div key={String(h.at) + h.handNumber} className="task-row">
              <div style={{ flex: 1 }}><b>#{h.handNumber} {h.headline}</b></div>
              <span className={h.heroDelta >= 0 ? "good" : "bad"}>{signedBb(h.heroDelta)}</span>
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
