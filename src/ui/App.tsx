import { useMemo, useState } from "react";
import { PRESETS, VILLAINS, VILLAIN_BY_ID } from "../villains/catalog";
import {
  canUsePreset,
  canUseVillain,
  createSession,
  isPro,
  isUnlocked,
  loadProfile,
  masteryPct,
  remainingDailyHands,
  saveProfile,
  sessionPatterns,
  archiveSession,
  canShowHint,
  saveCombo,
  exportProfile,
  importProfile,
  type Profile,
  type Screen,
  type Session,
} from "../state/store";
import { verifyCommit } from "../engine/fairness";
import { roundRobin } from "../engine/sim";
import { Avatar, Nav, Stars, signedBb } from "./bits";
import { TableScreen } from "./TableScreen";
import { History } from "./History";

export function App() {
  const [profile, setProfileState] = useState<Profile>(() => loadProfile());
  const [screen, setScreen] = useState<Screen>(profile.onboardingDone ? "home" : "onboarding");
  const [session, setSession] = useState<Session | null>(profile.lastSession ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [custom, setCustom] = useState<string[]>([]);

  function setProfile(next: Profile) {
    setProfileState(next);
    saveProfile(next);
  }

  function go(s: Screen) {
    setScreen(s);
  }

  function start(ids: string[], presetId?: string, tutorial = false) {
    const archived = archiveSession({ ...profile }, session);
    setProfile(archived);
    const s = createSession(ids, presetId, { tutorial });
    setSession(s);
    setScreen("table");
  }

  return (
    <div className="shell">
      {screen === "onboarding" && (
        <Onboarding
          onDone={() => {
            const next = { ...profile, onboardingDone: true };
            setProfile(next);
            start(["uncleho", "nitlee", "stationpark"], "intro", true);
          }}
        />
      )}
      {screen === "home" && (
        <Home profile={profile} session={session} go={go} resume={() => session && setScreen("table")} />
      )}
      {screen === "lobby" && (
        <Lobby
          profile={profile}
          setProfile={setProfile}
          custom={custom}
          setCustom={setCustom}
          start={start}
          back={() => go("home")}
        />
      )}
      {screen === "table" && session && (
        <TableScreen
          profile={profile}
          setProfile={setProfile}
          session={session}
          setSession={setSession}
          onExit={() => {
            const next = archiveSession({ ...profile }, session);
            setProfile(next);
            setScreen("report");
          }}
        />
      )}
      {screen === "report" && session && <Report session={session} profile={profile} go={go} />}
      {screen === "dex" && (
        <Dex
          profile={profile}
          open={(id) => {
            setDetailId(id);
            setScreen("detail");
          }}
        />
      )}
      {screen === "detail" && detailId && (
        <Detail
          id={detailId}
          profile={profile}
          setProfile={setProfile}
          back={() => go("dex")}
          duel={() => start([detailId, "uncleho", "nitlee", "stationpark", "foldjeong"].slice(0, 5))}
        />
      )}
      {screen === "reviews" && (
        <Reviews
          profile={profile}
          setProfile={setProfile}
        />
      )}
      {screen === "settings" && <SettingsScreen profile={profile} setProfile={setProfile} go={go} />}
      {screen === "fairness" && <Fairness session={session} go={go} />}
      {screen === "history" && <History profile={profile} go={go} />}
      <Nav screen={screen} go={go} hidden={screen === "table" || screen === "onboarding"} />
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  return (
    <section className="screen">
      <div className="eyebrow">VILLAINS</div>
      <h1 className="brand" style={{ marginTop: 12 }}>읽을 수 있는<br />상대.</h1>
      {step === 0 && (
        <>
          <p className="kicker" style={{ margin: "16px 0 24px" }}>
            15명의 AI 빌런이 각자 한두 개의 구멍을 가지고 있습니다. 찾아내고, 착취하고, 숫자로 확인하세요.
          </p>
          <button className="btn primary wide" onClick={() => setStep(1)}>포커 룰은 압니다</button>
          <button className="btn wide" style={{ marginTop: 8 }} onClick={() => setStep(1)}>간단히 보고 시작</button>
        </>
      )}
      {step === 1 && (
        <>
          <div className="card">
            <b>튜토리얼 테이블</b>
            <p className="kicker">삼촌 · 이대리 · 박사장이 앉아 있습니다. 힌트가 켜진 채로 30핸드만 치면 됩니다.</p>
          </div>
          <div className="card">
            <b>리뷰는 강제하지 않습니다</b>
            <p className="kicker">핸드가 끝나면 점만 뜹니다. 보고 싶을 때 탭하세요. 스킵하면 큐에 쌓입니다.</p>
          </div>
          <button className="btn primary wide" style={{ marginTop: 18 }} onClick={onDone}>입문 테이블 앉기</button>
        </>
      )}
    </section>
  );
}

function Home({
  profile,
  session,
  go,
  resume,
}: {
  profile: Profile;
  session: Session | null;
  go: (s: Screen) => void;
  resume: () => void;
}) {
  const focus = useMemo(() => {
    const worst = Object.entries(profile.mastery)
      .filter(([, m]) => m.handsPlayed >= 20)
      .sort((a, b) => a[1].bb / a[1].handsPlayed - b[1].bb / b[1].handsPlayed)[0];
    if (!worst) return "입문 테이블에서 삼촌과 박사장의 차이를 먼저 느껴보세요.";
    return `${VILLAIN_BY_ID[worst[0]].name} 상대 성적이 제일 낮습니다. 오늘 여기를 파세요.`;
  }, [profile.mastery]);

  return (
    <section className="screen">
      <div className="atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <div className="topbar">
        <div className="brand">VILLAINS<small>NLHE 착취 트레이너</small></div>
        <span className="tier">{profile.lifetimeHands} HANDS · 오늘 {remainingDailyHands(profile) >= 99999 ? "∞" : remainingDailyHands(profile)}</span>
      </div>
      {session && session.handsPlayed > 0 && (
        <button className="card" style={{ width: "100%", textAlign: "left" }} onClick={resume}>
          <div className="row"><span className="idx">00</span><span className="eyebrow">이어하기</span></div>
          <div className="row" style={{ marginTop: 6 }}>
            <b>핸드 #{session.handNumber}</b>
            <b className={session.bbDelta >= 0 ? "good" : "bad"}>{signedBb(session.bbDelta)}</b>
          </div>
        </button>
      )}
      <div className="insight">
        <div className="row"><span className="idx">01</span><span className="eyebrow">오늘의 집중</span></div>
        <p className="kicker" style={{ marginTop: 8 }}>{focus}</p>
        <div className="meter"><i style={{ width: "46%" }} /></div>
      </div>
      <button className="btn launch wide" style={{ margin: "12px 0" }} onClick={() => go("lobby")}>테이블 앉기</button>
      <button className="btn glass wide" onClick={() => go("history")}>플레이 기록 {profile.lifetimeHands}핸드</button>
      <div className="row" style={{ margin: "8px 0 10px" }}>
        <b>빌런 숙련도</b>
        <button className="btn ghost" onClick={() => go("dex")}>도감</button>
      </div>
      <div className="villain-grid">
        {VILLAINS.map((v) => {
          const lock = !isUnlocked(profile, v.id);
          const pct = masteryPct(profile.mastery[v.id]);
          return (
            <button key={v.id} className={`vcell ${lock ? "lock" : ""}`} onClick={() => go("dex")}>
              <Avatar id={v.id} />
              <div className="name">{lock ? "???" : v.name}</div>
              <div className="sub">TIER {v.tier}</div>
              <div className="bar"><i style={{ width: `${lock ? 0 : pct}%` }} /></div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Lobby({
  profile,
  setProfile,
  custom,
  setCustom,
  start,
  back,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  custom: string[];
  setCustom: (ids: string[]) => void;
  start: (ids: string[], preset?: string) => void;
  back: () => void;
}) {
  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn" onClick={back}>뒤로</button>
        <div className="eyebrow">테이블 선택</div>
        <span />
      </div>
      {PRESETS.map((p) => {
        const locked = p.villains.some((id) => !isUnlocked(profile, id)) || !canUsePreset(profile, p.id) || p.villains.some((id) => !canUseVillain(profile, id));
        return (
          <button key={p.id} className="card" style={{ width: "100%", textAlign: "left" }} disabled={locked} onClick={() => start([...p.villains], p.id)}>
            <div className="row">
              <b>{p.name}</b>
              <Stars n={p.stars} />
            </div>
            <p className="kicker">{p.goal}</p>
            <p className="kicker">{p.villains.map((id) => VILLAIN_BY_ID[id].name).join(" · ")}</p>
            {locked && <p className="kicker">아직 잠긴 빌런이 있습니다. 설정에서 전체 해금할 수 있습니다.</p>}
          </button>
        );
      })}
      <div className="card">
        <b>커스텀 5명</b>
        <p className="kicker">언락된 빌런을 골라 테이블을 만듭니다.</p>
        <div className="villain-grid" style={{ marginTop: 8 }}>
          {VILLAINS.map((v) => {
            const on = custom.includes(v.id);
            const lock = !isUnlocked(profile, v.id);
            return (
              <button
                key={v.id}
                className={`vcell ${lock ? "lock" : ""} ${on ? "sel on" : ""}`}
                disabled={lock}
                onClick={() => {
                  if (on) setCustom(custom.filter((x) => x !== v.id));
                  else if (custom.length < 5) setCustom([...custom, v.id]);
                }}
              >
                <Avatar id={v.id} />
                <div className="name">{v.name}</div>
              </button>
            );
          })}
        </div>
        <button className="btn glass wide" style={{ marginTop: 10 }} disabled={custom.length !== 5} onClick={() => {
          setProfile(saveCombo(profile, "조합 " + (profile.savedCombos.length + 1), custom));
        }}>조합 저장</button>
        <button className="btn launch wide" style={{ marginTop: 8 }} disabled={custom.length !== 5} onClick={() => start(custom)}>
          커스텀 시작 ({custom.length}/5)
        </button>
        {profile.savedCombos.map((c) => (
          <button key={c.name} className="btn glass wide" style={{ marginTop: 8 }} onClick={() => start(c.ids)}>
            {c.name} 불러 앉기
          </button>
        ))}
      </div>
    </section>
  );
}

function Report({ session, profile, go }: { session: Session; profile: Profile; go: (s: Screen) => void }) {
  const patterns = sessionPatterns(session);
  const vpip = session.heroStats.hands ? Math.round((session.heroStats.vpip / session.heroStats.hands) * 100) : 0;
  const pfr = session.heroStats.hands ? Math.round((session.heroStats.pfr / session.heroStats.hands) * 100) : 0;
  return (
    <section className="screen">
      <div className="eyebrow">세션 리포트</div>
      <h1 style={{ margin: "8px 0 12px" }}>{signedBb(session.bbDelta)}</h1>
      <div className="grid3">
        <div className="card"><div className="muted">핸드</div><b>{session.handsPlayed}</b></div>
        <div className="card"><div className="muted">VPIP</div><b>{vpip}</b></div>
        <div className="card"><div className="muted">PFR</div><b>{pfr}</b></div>
      </div>
      <div className="card">
        <b>빌런별</b>
        {session.villainIds.map((id) => {
          const m = profile.mastery[id];
          return (
            <div key={id} className="list-item">
              <Avatar id={id} />
              <div style={{ flex: 1 }}>
                <div className="row"><b>{VILLAIN_BY_ID[id].name}</b><span>{masteryPct(m)}%</span></div>
                <div className="bar"><i style={{ width: `${masteryPct(m)}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
      {isPro(profile) && <div className="card">
        <div className="row"><span className="idx">02</span><b>반복 실수</b></div>
        {patterns.length === 0 && <p className="kicker">아직 반복 패턴이 없습니다.</p>}
        {patterns.map((p) => (
          <div key={p.tag} className="task-row">
            <div style={{ flex: 1 }}>
              <b>{p.tag}</b>
              <div className="kicker">{p.count}회 · -{p.loss.toFixed(1)}bb</div>
            </div>
            <span className="status">TRACE</span>
          </div>
        ))}
      </div>}
      <p className="kicker">놓친 착취 {session.missedExploits ?? 0}개 · 놓친 리뷰 {profile.reviewQueue.filter((r) => !r.viewed).length}개</p>
      {session.fairness && (
        <div className="card">
          <div className="row"><span className="idx">SEED</span><b>시드 공개</b></div>
          <p className="kicker">hash {session.fairness.seedServerHash}</p>
          <p className="kicker">server {session.fairness.seedServer}</p>
          <p className="kicker">client {session.seedClient}</p>
        </div>
      )}
      <button className="btn launch wide" onClick={() => go("home")}>홈으로</button>
      <button className="btn wide" style={{ marginTop: 8 }} onClick={() => go("reviews")}>리뷰 몰아보기</button>
      <button className="btn glass wide" style={{ marginTop: 8 }} onClick={() => go("history")}>플레이 기록</button>
    </section>
  );
}

function Dex({ profile, open }: { profile: Profile; open: (id: string) => void }) {
  return (
    <section className="screen">
      <div className="topbar">
        <div className="brand">도감<small>15 VILLAINS</small></div>
      </div>
      {(["S", "A", "B", "C"] as const).map((tier) => (
        <div key={tier}>
          <div className="eyebrow" style={{ margin: "12px 0 8px" }}>TIER {tier}</div>
          {VILLAINS.filter((v) => v.tier === tier).map((v) => {
            const lock = !isUnlocked(profile, v.id);
            const m = profile.mastery[v.id];
            return (
              <button key={v.id} className="list-item" style={{ width: "100%", textAlign: "left" }} onClick={() => open(v.id)}>
                <Avatar id={v.id} />
                <div style={{ flex: 1 }}>
                  <div className="row">
                    <b>{lock ? "잠김" : v.name}</b>
                    <span className="tier">{v.tier}</span>
                  </div>
                  <div className="kicker">{lock ? v.unlock : v.archetype}</div>
                  <div className="bar"><i style={{ width: `${lock ? 0 : masteryPct(m)}%` }} /></div>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function Detail({
  id,
  profile,
  setProfile,
  back,
  duel,
}: {
  id: string;
  profile: Profile;
  setProfile: (p: Profile) => void;
  back: () => void;
  duel: () => void;
}) {
  const v = VILLAIN_BY_ID[id];
  const m = profile.mastery[id];
  const lock = !isUnlocked(profile, id);
  const canHint = canShowHint(profile, id);
  return (
    <section className="screen">
      <button className="btn" onClick={back}>도감</button>
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0" }}>
        <Avatar id={id} size="lg" />
        <div>
          <div className="eyebrow">{v.handle}</div>
          <h1>{lock ? "???" : v.name}</h1>
          <div className="kicker">{v.archetype}</div>
        </div>
      </div>
      <div className="grid3">
        <div className="card"><div className="muted">핸드</div><b>{m.handsPlayed}</b></div>
        <div className="card"><div className="muted">bb/100</div><b>{m.handsPlayed ? ((m.bb / m.handsPlayed) * 100).toFixed(1) : "—"}</b></div>
        <div className="card"><div className="muted">숙련</div><b>{masteryPct(m)}%</b></div>
      </div>
      <div className="card">
        <b>배울 것</b>
        <p className="kicker">{v.lesson}</p>
      </div>
      <div className="card">
        <div className="row">
          <b>Leak 힌트</b>
          <span className="muted">{m.leaksFound.length}/{v.leaks.length}</span>
        </div>
        {canHint ? (
          <>
            <p className="kicker">{v.leaks[0].discoveryHint}</p>
            <p className="kicker">{v.exploit}</p>
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                const next = structuredClone(profile);
                next.mastery[id].hintsUsed = true;
                if (!next.mastery[id].leaksFound.includes(v.leaks[0].type)) next.mastery[id].leaksFound.push(v.leaks[0].type);
                setProfile(next);
              }}
            >
              힌트 본 것으로 기록
            </button>
          </>
        ) : (
          <p className="kicker">이 빌런과 3세션 정도 친 뒤에 힌트가 열립니다.</p>
        )}
      </div>
      <p className="kicker">완벽 대응 {v.expectedBb100} bb/100</p>
      <button className="btn primary wide" disabled={lock} onClick={duel}>이 빌런 포함해 앉기</button>
    </section>
  );
}

function Reviews({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const [i, setI] = useState(0);
  const list = profile.reviewQueue;
  const cur = list[i];
  if (!cur) {
    return (
      <section className="screen">
        <h1>리뷰 큐</h1>
        <p className="kicker">밀린 리뷰가 없습니다.</p>
      </section>
    );
  }
  return (
    <section className="screen">
      <div className="eyebrow">리뷰 큐 {i + 1}/{list.length}</div>
      <h1 style={{ margin: "8px 0" }}>{cur.headline}</h1>
      <p className="kicker">{cur.body}</p>
      <div className="card">
        <div className="row"><span>{cur.statLabel}</span><b>{cur.statValue}</b></div>
        <div className="row"><span>손실</span><b className="bad">−{cur.totalLossBb}bb</b></div>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <button
          className="btn"
          onClick={() => {
            const next = structuredClone(profile);
            next.reviewQueue[i].viewed = true;
            setProfile(next);
            setI((n) => Math.min(n + 1, list.length - 1));
          }}
        >
          읽음
        </button>
        <button className="btn primary" onClick={() => setI((n) => (n + 1) % list.length)}>다음</button>
      </div>
    </section>
  );
}

function SettingsScreen({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const s = profile.settings;
  function patch(partial: Partial<Profile["settings"]>) {
    setProfile({ ...profile, settings: { ...s, ...partial } });
  }
  return (
    <section className="screen">
      <h1>설정</h1>
      <div className="card">
        <b>HUD</b>
        <div className="grid2" style={{ marginTop: 8 }}>
          {(["learn", "standard", "split", "off"] as const).map((m) => (
            <button key={m} className={`sel ${s.hudMode === m ? "on" : ""}`} onClick={() => patch({ hudMode: m })}>
              {m === "learn" ? "학습" : m === "standard" ? "표준" : m === "split" ? "조건부" : "관찰"}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <b>리뷰 자동 정지</b>
        <div className="grid2" style={{ marginTop: 8 }}>
          {(["off", "red", "yellow", "all"] as const).map((m) => (
            <button key={m} className={`sel ${s.reviewPause === m ? "on" : ""}`} onClick={() => patch({ reviewPause: m })}>
              {m === "off" ? "끄기" : m === "red" ? "큰 실수" : m === "yellow" ? "모든 실수" : "모든 핸드"}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <b>슬로우롤 텔</b>
        <div className="grid3" style={{ marginTop: 8 }}>
          {[
            [0.9, "쉬움"],
            [0.78, "보통"],
            [0.64, "어려움"],
          ].map(([n, label]) => (
            <button key={label} className={`sel ${s.tellDifficulty === n ? "on" : ""}`} onClick={() => patch({ tellDifficulty: n as number })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <b>애니메이션</b>
        <input type="range" min={0.7} max={2} step={0.1} value={s.animSpeed} onChange={(e) => patch({ animSpeed: Number(e.target.value) })} />
      </div>
      <div className="card">
        <div className="row">
          <b>전체 빌런 해금</b>
          <button className={`sel ${s.unlockAll ? "on" : ""}`} onClick={() => patch({ unlockAll: !s.unlockAll })}>
            {s.unlockAll ? "ON" : "OFF"}
          </button>
        </div>
        <p className="kicker">프리뷰용입니다. 끄면 기획서의 언락 순서를 따릅니다.</p>
      </div>
      <div className="card">
        <div className="row">
          <b>Pro</b>
          <button className={`sel ${s.isPro ? "on" : ""}`} onClick={() => patch({ isPro: !s.isPro })}>
            {s.isPro ? "ON" : "OFF"}
          </button>
        </div>
        <p className="kicker">결제 연동 전 개발 스위치. 켜면 15명, 무제한 핸드, L2/패턴/조건부 HUD가 열립니다.</p>
      </div>
      <button className="btn wide" onClick={() => go("fairness")}>공정성 검증 / 자기대전</button>
      <button className="btn glass wide" style={{ marginTop: 8 }} onClick={() => {
        const blob = new Blob([exportProfile(profile)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "villains-profile.json";
        a.click();
      }}>기록 내보내기</button>
      <label className="btn glass wide" style={{ marginTop: 8, display: "grid", placeItems: "center" }}>
        기록 가져오기
        <input type="file" accept="application/json" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          file.text().then((raw) => {
            try { setProfile(importProfile(raw)); } catch { /* ignore bad file */ }
          });
        }} />
      </label>
    </section>
  );
}

function Fairness({ session, go }: { session: Session | null; go: (s: Screen) => void }) {
  const [server, setServer] = useState(session?.fairness?.seedServer ?? "");
  const [hash, setHash] = useState(session?.fairness?.seedServerHash ?? "");
  const [ok, setOk] = useState<string>("");
  const [rows, setRows] = useState<{ name: string; bb100: number; hands: number }[] | null>(null);
  return (
    <section className="screen">
      <h1>공정성</h1>
      <p className="kicker">세션 시작 때 서버 시드 해시를 먼저 공개합니다. 종료 후 원문을 넣으면 같은 해시가 나와야 합니다. 빌런 정책은 상대 홀카드를 인자로 받지 않습니다.</p>
      <div className="card">
        <div className="muted">commit hash</div>
        <b style={{ wordBreak: "break-all", fontSize: 12 }}>{hash || "세션 없음"}</b>
        <input style={{ width: "100%", marginTop: 8, background: "#12141a", border: "1px solid #333", color: "inherit", padding: 8, borderRadius: 8 }} value={server} onChange={(e) => setServer(e.target.value)} placeholder="seed_server" />
        <button className="btn primary wide" style={{ marginTop: 8 }} onClick={() => setOk(verifyCommit(server, hash) ? "검증 성공" : "불일치")}>{ok || "해시 검증"}</button>
      </div>
      {session && (
        <div className="card">
          <div className="row"><span>client</span><b style={{ fontSize: 11 }}>{session.seedClient.slice(0, 12)}…</b></div>
          <div className="row"><span>final</span><b style={{ fontSize: 11 }}>{session.seed.slice(0, 16)}…</b></div>
        </div>
      )}
      <div className="card">
        <b>자기대전 샘플</b>
        <p className="kicker">브라우저에서 약 240핸드만 돌립니다. 기획서의 50만 핸드는 CI용입니다.</p>
        <button className="btn wide" onClick={() => setRows(roundRobin(240))}>돌리기</button>
        {rows && rows.map((r) => (
          <div key={r.id} className="row" style={{ marginTop: 6 }}><span>{r.name}</span><b>{r.bb100.toFixed(1)}</b></div>
        ))}
      </div>
      <button className="btn wide" onClick={() => go("settings")}>설정으로</button>
    </section>
  );
}
