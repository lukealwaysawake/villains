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
  saveProfile,
  archiveSession,
  canShowHint,
  saveCombo,
  exportProfile,
  importProfile,
  topHabits,
  type Profile,
  type Screen,
  type Session,
  type RoomConfig,
} from "../state/store";
import { verifyCommit } from "../engine/fairness";
import { roundRobin } from "../engine/sim";
import { Avatar, Nav, PlayingCard, ChipStack, Stars, signedBb } from "./bits";
import { TableScreen } from "./TableScreen";
import { Analyze } from "./Analyze";
import { SessionRecap } from "./SessionRecap";
import { CreateRoom } from "./CreateRoom";

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

  function start(ids: string[], presetId?: string, tutorial = false, room?: RoomConfig) {
    const archived = archiveSession({ ...profile }, session);
    setProfile(archived);
    const s = createSession(ids, presetId, { tutorial, room });
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
            go("create-room");
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
          go={go}
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
      {screen === "report" && session && <SessionRecap session={session} profile={profile} go={go} />}
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
          go={go}
        />
      )}
      {screen === "settings" && <SettingsScreen profile={profile} setProfile={setProfile} go={go} />}
      {screen === "fairness" && <Fairness session={session} go={go} />}
      {(screen === "history" || screen === "analyze") && <Analyze profile={profile} go={go} />}
      {screen === "create-room" && (
        <CreateRoom
          profile={profile}
          onBack={() => go("home")}
          onCreate={(room, ids) => start(ids, "custom", false, room)}
        />
      )}
      <Nav screen={screen} go={go} hidden={screen === "table" || screen === "onboarding" || screen === "create-room"} />
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <section className="screen boot">
      <div className="splash-hero" aria-hidden="true" />
      <div className="splash-shade" aria-hidden="true" />
      <div className="boot-top">
        <img className="splash-mark" src="/brand/mark.jpg" alt="" />
        <div className="eyebrow">VILLAINS</div>
      </div>
      <div className="boot-stage" aria-hidden="true">
        <div className="boot-felt">
          <div className="boot-cards">
            <PlayingCard card={{ rank: 14, suit: 1 }} delay={40} />
            <PlayingCard card={{ rank: 13, suit: 1 }} delay={90} />
            <PlayingCard card={{ rank: 12, suit: 0 }} delay={140} />
            <PlayingCard card={{ rank: 11, suit: 2 }} delay={190} />
            <PlayingCard card={{ rank: 10, suit: 3 }} delay={240} />
          </div>
          <div className="boot-pot"><ChipStack n={4} /> POT</div>
        </div>
        <div className="boot-ava a1"><Avatar id="uncleho" /></div>
        <div className="boot-ava a2"><Avatar id="nitlee" /></div>
        <div className="boot-ava a3"><Avatar id="stationpark" /></div>
      </div>
      <h1 className="brand on-title">읽을 수 있는<br/>상대</h1>
      <div className="on-body">
        <p className="kicker">인원이랑 상대를 고르고 앉는다.</p>
        <button className="btn primary wide" onClick={onDone}>테이블 구성</button>
      </div>
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
    const habit = topHabits(profile, 2)[0];
    if (habit) return `${habit.tag} · ${habit.count}회. 분석 탭에서 보세요.`;
    if (!worst) return "삼촌이랑 박사장부터 붙어 보세요.";
    return `${VILLAIN_BY_ID[worst[0]].name}한테 제일 많이 잃었습니다.`;
  }, [profile]);

  return (
    <section className="screen">
      <div className="atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <div className="home-hero">
        <img src="/brand/hero.jpg" alt="" />
        <div className="home-hero-copy">
          <img src="/brand/mark.jpg" alt="" />
          <div>
            <b>VILLAINS</b>
            <small>착취 연습 · {profile.lifetimeHands}핸드</small>
          </div>
        </div>
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
        <div className="row"><span className="idx">01</span><span className="eyebrow">오늘</span></div>
        <p className="kicker" style={{ marginTop: 8 }}>{focus}</p>
      </div>
      <button className="btn launch wide" style={{ margin: "12px 0 8px" }} onClick={() => go("create-room")}>테이블</button>
      <button className="btn glass wide" onClick={() => go("analyze")}>분석 · 기보</button>
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
  go,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  custom: string[];
  setCustom: (ids: string[]) => void;
  start: (ids: string[], preset?: string) => void;
  back: () => void;
  go: (s: Screen) => void;
}) {
  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn" onClick={back}>뒤로</button>
        <div className="eyebrow">테이블 선택</div>
        <span />
      </div>
      <button className="btn launch wide" style={{ marginBottom: 12 }} onClick={() => go("create-room")}>방 만들기</button>
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

function Reviews({ profile, setProfile, go }: { profile: Profile; setProfile: (p: Profile) => void; go: (s: Screen) => void }) {
  const [i, setI] = useState(0);
  const list = profile.reviewQueue;
  const cur = list[i];
  if (!cur) {
    return (
      <section className="screen">
        <div className="topbar"><button className="btn glass" onClick={() => go("analyze")}>분석</button><div className="eyebrow">리뷰</div><span /></div>
        <h1>리뷰 큐</h1>
        <p className="kicker">밀린 리뷰가 없습니다. 핸드 치면 여기로 옵니다.</p>
      </section>
    );
  }
  return (
    <section className="screen">
      <div className="topbar"><button className="btn glass" onClick={() => go("analyze")}>분석</button><div className="eyebrow">리뷰 큐 {i + 1}/{list.length}</div><span /></div>
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

function SettingsScreen({ profile, setProfile, go }: { profile: Profile; setProfile: (p: Profile) => void; go: (s: Screen) => void }) {
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
