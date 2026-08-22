import { useMemo, useRef, useState } from "react";
import { VILLAINS, VILLAIN_BY_ID } from "../villains/catalog";
import {
  createSession,
  defaultRoom,
  rememberRoom,
  canResume,
  loadProfile,
  masteryPct,
  saveProfile,
  archiveSession,
  canShowHint,
  exportProfile,
  importProfile,
  topHabits,
  type Profile,
  type Screen,
  type Session,
  type RoomConfig,
} from "../state/store";
import { verifyCommit } from "../engine/fairness";
import { roundRobin, behaviorProbe, type BehaviorRow } from "../engine/sim";
import { Avatar, Nav, PageHeader, PlayingCard, ChipStack, Segmented, signedBb } from "./bits";
import { TableScreen } from "./TableScreen";
import { Analyze } from "./Analyze";
import { SessionRecap } from "./SessionRecap";
import { CreateRoom } from "./CreateRoom";

function practiceLineup(primaryId: string): string[] {
  const fillers = ["uncleho", "nitlee", "stationpark", "foldjeong", "weekend", "bulldozer"];
  return [...new Set([primaryId, ...fillers])].slice(0, 5);
}

export function App() {
  const [profile, setProfileState] = useState<Profile>(() => loadProfile());
  const [screen, setScreen] = useState<Screen>(profile.onboardingDone ? "home" : "onboarding");
  const [session, setSession] = useState<Session | null>(profile.lastSession ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailBack, setDetailBack] = useState<"home" | "dex">("dex");
  const [pendingStart, setPendingStart] = useState<{ ids: string[]; presetId?: string; tutorial: boolean; room?: RoomConfig; baseProfile: Profile } | null>(null);

  function setProfile(next: Profile) {
    setProfileState(next);
    saveProfile(next);
  }

  function go(s: Screen) {
    setScreen(s);
  }

  function start(ids: string[], presetId?: string, tutorial = false, room?: RoomConfig, baseProfile: Profile = profile, confirmed = false) {
    if (!confirmed && session?.liveTable && session.liveTable.street !== "complete") {
      setPendingStart({ ids, presetId, tutorial, room, baseProfile });
      return;
    }
    const archived = archiveSession({ ...baseProfile }, session);
    const s = createSession(ids, presetId, { tutorial, room });
    setProfile(rememberRoom(archived, s.room ?? defaultRoom(), s.villainIds));
    setSession(s);
    setScreen("table");
  }

  return (
    <div className="shell">
      {screen === "onboarding" && (
        <Onboarding
          onQuickStart={() => {
            const next = { ...profile, onboardingDone: true };
            const room = defaultRoom({ name: "입문 테이블", seats: 4, sb: 0.5, bb: 1, startStack: 100 });
            start(["uncleho", "nitlee", "stationpark"], "intro", true, room, next);
          }}
          onCustomize={() => {
            setProfile({ ...profile, onboardingDone: true });
            go("create-room");
          }}
        />
      )}
      {screen === "home" && (
        <Home
          profile={profile}
          session={session}
          go={go}
          resume={() => session && setScreen("table")}
          again={() => {
            const lr = profile.lastRoom;
            if (!lr) return go("create-room");
            start(lr.villainIds, "custom", false, lr.room);
          }}
          openVillain={(id) => {
            setDetailId(id);
            setDetailBack("home");
            setScreen("detail");
          }}
        />
      )}
      {screen === "table" && session && (
        <TableScreen
          profile={profile}
          setProfile={setProfile}
          session={session}
          setSession={setSession}
          onExit={() => {
            const ended = { ...session, liveTable: null };
            const next = archiveSession({ ...profile, lastSession: ended }, ended);
            setSession(ended);
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
            setDetailBack("dex");
            setScreen("detail");
          }}
        />
      )}
      {screen === "detail" && detailId && (
        <Detail
          id={detailId}
          profile={profile}
          setProfile={setProfile}
          back={() => go(detailBack)}
          duel={() => start(practiceLineup(detailId))}
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
          initial={profile.lastRoom ? { ...profile.lastRoom.room, villainIds: profile.lastRoom.villainIds } : undefined}
          onBack={() => go("home")}
          onCreate={(room, ids) => start(ids, "custom", false, room)}
        />
      )}
      <Nav screen={screen} go={go} hidden={["table", "onboarding", "create-room", "report", "detail", "reviews", "fairness"].includes(screen)} />
      {pendingStart && (
        <div className="app-confirm" role="dialog" aria-modal="true" aria-label="새 테이블 시작 확인" onClick={() => setPendingStart(null)}>
          <div className="panel" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <span className="eyebrow">NEW TABLE</span>
            <h2>진행 중인 핸드를 바꿀까요?</h2>
            <p>현재 핸드는 종료되고, 선택한 상대와 새 테이블이 시작됩니다.</p>
            <div className="review-actions">
              <button className="btn glass" onClick={() => setPendingStart(null)}>취소</button>
              <button className="btn danger" onClick={() => {
                const request = pendingStart;
                setPendingStart(null);
                start(request.ids, request.presetId, request.tutorial, request.room, request.baseProfile, true);
              }}>새 테이블 시작</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Onboarding({ onQuickStart, onCustomize }: { onQuickStart: () => void; onCustomize: () => void }) {
  return (
    <section className="screen boot">
      <div className="splash-hero" aria-hidden="true" />
      <div className="splash-shade" aria-hidden="true" />
      <div className="boot-top">
        <img className="splash-mark" src="/brand/mark.jpg" alt="" />
        <div>
          <div className="eyebrow">VILLAINS</div>
          <span className="boot-label">NLHE 상대 읽기 트레이너</span>
        </div>
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
      <div className="boot-copy">
        <h1 className="on-title">상대를 읽고<br/>더 좋은 결정을.</h1>
        <p>연습 칩으로 플레이하고, 매 핸드 놓친 착취 포인트를 바로 복기합니다.</p>
      </div>
      <div className="on-body">
        <div className="quick-lineup" aria-label="추천 상대 삼촌, 이대리, 박사장">
          <span>4인 · $0.5/$1 · $100</span>
          <div><Avatar id="uncleho" /><Avatar id="nitlee" /><Avatar id="stationpark" /></div>
        </div>
        <button className="btn primary wide" onClick={onQuickStart}>추천 테이블에 앉기</button>
        <button className="btn ghost wide" onClick={onCustomize}>상대와 금액 바꾸기</button>
      </div>
    </section>
  );
}

function Home({
  profile,
  session,
  go,
  resume,
  again,
  openVillain,
}: {
  profile: Profile;
  session: Session | null;
  go: (s: Screen) => void;
  resume: () => void;
  again: () => void;
  openVillain: (id: string) => void;
}) {
  const lastRoom = profile.lastRoom;
  const live = canResume(session);
  const lineup = (lastRoom?.villainIds.length ? lastRoom.villainIds : ["uncleho", "nitlee", "stationpark"]).slice(0, 3);
  const focus = useMemo(() => {
    const worst = Object.entries(profile.mastery)
      .filter(([, m]) => m.handsPlayed >= 20)
      .sort((a, b) => a[1].bb / a[1].handsPlayed - b[1].bb / b[1].handsPlayed)[0];
    const habit = topHabits(profile, 2)[0];
    if (habit) return `${habit.tag}이 ${habit.count}번 반복됐어요. 다음 테이블에서 먼저 확인하세요.`;
    if (!worst) return "첫 목표는 상대의 콜 빈도와 프리플랍 공격성을 구분하는 것입니다.";
    return `${VILLAIN_BY_ID[worst[0]].name} 상대로 가장 많은 손실이 났어요.`;
  }, [profile]);

  const room = lastRoom?.room ?? defaultRoom();
  return (
    <section className="screen home-screen">
      <div className="atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <header className="home-header">
        <div className="home-brand">
          <img src="/brand/mark.jpg" alt="" />
          <div><b>VILLAINS</b><span>상대 읽기 트레이너</span></div>
        </div>
        <span className="stat-pill">{profile.lifetimeHands} 핸드</span>
      </header>

      <section className="table-card" aria-labelledby="home-table-title">
        <div className="table-card-head">
          <div>
            <span className="eyebrow">{live ? "진행 중" : lastRoom ? "지난 테이블" : "추천 테이블"}</span>
            <h1 id="home-table-title">{lastRoom?.room.name ?? "입문 테이블"}</h1>
            <p>${room.sb}/${room.bb} · {room.seats}인 · 바이인 ${room.startStack}</p>
          </div>
          {session && session.handsPlayed > 0 && (
            <b className={`session-result ${session.bbDelta >= 0 ? "good" : "bad"}`}>{signedBb(session.bbDelta)}</b>
          )}
        </div>
        <div className="lineup-row">
          <div className="avatar-stack">{lineup.map((id) => <Avatar key={id} id={id} />)}</div>
          <span>{lineup.map((id) => VILLAIN_BY_ID[id]?.name).join(" · ")}</span>
        </div>
        <button className="btn primary wide" onClick={live ? resume : again}>
          {live ? `#${session?.handNumber ?? 1} 이어서 플레이` : lastRoom ? "같은 테이블 다시 시작" : "추천 테이블 시작"}
        </button>
        <button className="btn ghost wide" onClick={() => go("create-room")}>상대와 금액 바꾸기</button>
      </section>

      <button className="insight home-insight" onClick={() => go("analyze")}>
        <span className="insight-icon" aria-hidden="true">↗</span>
        <span><small>오늘의 포커스</small><b>{focus}</b></span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>

      <div className="section-head">
        <div><span className="eyebrow">LINEUP</span><h2>오늘의 상대</h2></div>
        <button className="text-link" onClick={() => go("dex")}>전체 15명</button>
      </div>
      <div className="opponent-list">
        {lineup.map((id) => {
          const villain = VILLAIN_BY_ID[id];
          const pct = masteryPct(profile.mastery[id]);
          return (
            <button key={id} className="opponent-row" onClick={() => openVillain(id)}>
              <Avatar id={id} />
              <span className="opponent-copy"><b>{villain.name}</b><small>{villain.archetype}</small></span>
              <span className="mastery"><b>{pct}%</b><small>숙련</small></span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Dex({ profile, open }: { profile: Profile; open: (id: string) => void }) {
  const [tierFilter, setTierFilter] = useState<"ALL" | "S" | "A" | "B" | "C">("ALL");
  const tiers = tierFilter === "ALL" ? (["S", "A", "B", "C"] as const) : [tierFilter];
  return (
    <section className="screen dex-screen">
      <div className="page-title">
        <span className="eyebrow">OPPONENTS</span>
        <h1>상대 도감</h1>
        <p>플레이 성향과 발견한 약점을 확인하세요.</p>
      </div>
      <Segmented
        label="상대 티어 필터"
        value={tierFilter}
        options={[
          { value: "ALL", label: "전체" },
          { value: "S", label: "S" },
          { value: "A", label: "A" },
          { value: "B", label: "B" },
          { value: "C", label: "C" },
        ]}
        onChange={setTierFilter}
        columns={5}
        className="tier-filter"
      />
      {tiers.map((tier) => (
        <div key={tier} className="tier-section">
          {tierFilter === "ALL" && <div className="eyebrow tier-heading">TIER {tier}</div>}
          {VILLAINS.filter((v) => v.tier === tier).map((v) => {
            const m = profile.mastery[v.id];
            return (
              <button key={v.id} className="list-item villain-list-item" onClick={() => open(v.id)}>
                <Avatar id={v.id} />
                <div className="list-copy">
                  <div className="row">
                    <b>{v.name}</b>
                    <span className="tier">{v.tier}</span>
                  </div>
                  <div className="kicker">{v.archetype}</div>
                  <div className="bar"><i style={{ width: `${masteryPct(m)}%` }} /></div>
                </div>
                <span className="chevron" aria-hidden="true">›</span>
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
  const canHint = canShowHint(profile, id);
  return (
    <section className="screen detail-screen no-nav">
      <PageHeader eyebrow="OPPONENT" title="상대 분석" onBack={back} titleAs="span" />
      <div className="detail-hero">
        <Avatar id={id} size="lg" />
        <div>
          <div className="eyebrow">{v.handle}</div>
          <h1>{v.name}</h1>
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
      <button className="btn primary wide" onClick={duel}>이 빌런 포함해 앉기</button>
    </section>
  );
}

function Reviews({ profile, setProfile, go }: { profile: Profile; setProfile: (p: Profile) => void; go: (s: Screen) => void }) {
  const [i, setI] = useState(0);
  const list = profile.reviewQueue;
  const cur = list[i];
  if (!cur) {
    return (
      <section className="screen no-nav">
        <PageHeader eyebrow="REVIEWS" title="리뷰 큐" onBack={() => go("analyze")} backLabel="기록으로 돌아가기" />
        <p className="kicker">밀린 리뷰가 없습니다. 핸드 치면 여기로 옵니다.</p>
      </section>
    );
  }
  return (
    <section className="screen no-nav">
      <PageHeader eyebrow={`REVIEW ${i + 1}/${list.length}`} title="결정 복기" onBack={() => go("analyze")} backLabel="기록으로 돌아가기" titleAs="span" />
      <h1 className="review-page-title">{cur.headline}</h1>
      <p className="kicker">{cur.body}</p>
      <div className="card">
        <div className="row"><span>{cur.statLabel}</span><b>{cur.statValue}</b></div>
        <div className="row"><span>손실</span><b className="bad">−{cur.totalLossBb}bb</b></div>
      </div>
      <div className="button-pair review-page-actions">
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
  const [transferMessage, setTransferMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  function patch(partial: Partial<Profile["settings"]>) {
    setProfile({ ...profile, settings: { ...s, ...partial } });
  }
  return (
    <section className="screen settings-screen">
      <div className="page-title">
        <span className="eyebrow">PREFERENCES</span>
        <h1>설정</h1>
        <p>테이블에서 보이는 정보와 복기 흐름을 조절합니다.</p>
      </div>
      <div className="card setting-card">
        <div className="setting-heading"><b>테이블 정보</b><p>상대 통계를 얼마나 자세히 볼지 선택하세요.</p></div>
        <Segmented
          label="테이블 정보 표시"
          value={s.hudMode}
          options={[
            { value: "learn", label: "항상" },
            { value: "standard", label: "기본" },
            { value: "split", label: "선택한 상대" },
            { value: "off", label: "끄기" },
          ]}
          onChange={(hudMode) => patch({ hudMode })}
          columns={2}
        />
      </div>
      <div className="card setting-card">
        <div className="setting-heading"><b>자동 복기</b><p>어떤 결과에서 핸드를 멈추고 복기를 열지 선택하세요.</p></div>
        <Segmented
          label="자동 복기 범위"
          value={s.reviewPause}
          options={[
            { value: "off", label: "끄기" },
            { value: "red", label: "큰 실수" },
            { value: "yellow", label: "모든 실수" },
            { value: "all", label: "모든 핸드" },
          ]}
          onChange={(reviewPause) => patch({ reviewPause })}
          columns={2}
        />
      </div>
      <div className="card setting-card">
        <div className="setting-heading"><b>타이밍 텔 난이도</b><p>상대의 행동 속도에서 얻는 단서를 조절합니다.</p></div>
        <Segmented
          label="타이밍 텔 난이도"
          value={s.tellDifficulty}
          options={[
            { value: 0.9, label: "쉬움" },
            { value: 0.78, label: "보통" },
            { value: 0.64, label: "어려움" },
          ]}
          onChange={(tellDifficulty) => patch({ tellDifficulty })}
          columns={3}
        />
      </div>
      <div className="card setting-card">
        <div className="setting-heading row"><div><b>진행 속도</b><p>카드와 상대 액션의 재생 속도입니다.</p></div><span className="form-value">{s.animSpeed < 0.9 ? "느리게" : s.animSpeed > 1.3 ? "빠르게" : "보통"}</span></div>
        <input aria-label="진행 속도" type="range" min={0.7} max={2} step={0.1} value={s.animSpeed} onChange={(e) => patch({ animSpeed: Number(e.target.value) })} />
      </div>
      <div className="settings-section-label">데이터</div>
      <div className="settings-actions">
        <button type="button" className="settings-action" onClick={() => go("fairness")}>
          <span><b>게임 엔진과 공정성</b><small>시드 검증과 성향 측정을 확인합니다.</small></span><i aria-hidden="true">›</i>
        </button>
        <button type="button" className="settings-action" onClick={() => {
          const blob = new Blob([exportProfile(profile)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "villains-profile.json";
          a.click();
          setTransferMessage("기록 파일을 저장했습니다.");
        }}>
          <span><b>기록 내보내기</b><small>현재 기록을 JSON 파일로 저장합니다.</small></span><i aria-hidden="true">↓</i>
        </button>
        <button type="button" className="settings-action" onClick={() => fileInputRef.current?.click()}>
          <span><b>기록 가져오기</b><small>VILLAINS 기록 파일로 복원합니다.</small></span><i aria-hidden="true">↑</i>
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          file.text().then((raw) => {
            try {
              setProfile(importProfile(raw));
              setTransferMessage("기록을 가져왔습니다.");
            } catch {
              setTransferMessage("파일을 읽지 못했습니다. VILLAINS 기록 파일인지 확인하세요.");
            } finally {
              e.target.value = "";
            }
          });
        }} />
      </div>
      {transferMessage && <p className="transfer-status" role="status">{transferMessage}</p>}
    </section>
  );
}

function Fairness({ session, go }: { session: Session | null; go: (s: Screen) => void }) {
  const [server, setServer] = useState(session?.fairness?.seedServer ?? "");
  const [hash] = useState(session?.fairness?.seedServerHash ?? "");
  const [ok, setOk] = useState<string>("");
  const [rows, setRows] = useState<{ id: string; name: string; bb100: number; hands: number }[] | null>(null);
  const [probe, setProbe] = useState<BehaviorRow[] | null>(null);
  return (
    <section className="screen fairness-screen no-nav">
      <PageHeader eyebrow="SYSTEM" title="공정성" onBack={() => go("settings")} backLabel="설정으로 돌아가기" />
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
      <div className="card">
        <b>빌런 성향 검증</b>
        <p className="kicker">설계값(스펙) 대비 실제 플레이를 측정합니다. 300핸드 자기대전으로 몇 초 걸립니다.</p>
        <button className="btn wide" onClick={() => setProbe(behaviorProbe(300))}>성향 측정</button>
        {probe && (
          <div className="probe-rows">
            <div className="probe-head">
              <span>빌런</span><span>VPIP</span><span>PFR</span><span>AF</span><span>판정</span>
            </div>
            {probe.map((r) => (
              <div key={r.id} className="probe-row">
                <span className="pr-name">{r.name}<em>{r.archetype}</em></span>
                <span>{r.vpipSpec}<i>{r.vpip}</i></span>
                <span>{r.pfrSpec}<i>{r.pfr}</i></span>
                <span>{r.afSpec}<i>{r.af}</i></span>
                <span className={r.ok ? "good" : "bad"}>{r.ok ? "정상" : "이탈"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
