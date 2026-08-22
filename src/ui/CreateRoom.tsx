import { useState } from "react";
import { PRESETS, VILLAINS } from "../villains/catalog";
import { canUseVillain, isUnlocked, type Profile, type RoomConfig } from "../state/store";
import { Avatar } from "./bits";

export function CreateRoom({
  profile,
  initial,
  onBack,
  onCreate,
}: {
  profile: Profile;
  initial?: Partial<RoomConfig>;
  onBack: () => void;
  onCreate: (room: RoomConfig, villainIds: string[]) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "캐시 테이블");
  const [seats, setSeats] = useState<2 | 4 | 6>(initial?.seats ?? 6);
  const [buyInBb, setBuyInBb] = useState<50 | 100 | 200>(initial?.buyInBb ?? 100);
  const [autoRebuy, setAutoRebuy] = useState(initial?.autoRebuy ?? true);
  const [speed, setSpeed] = useState(initial?.speed ?? 1);
  const [picks, setPicks] = useState<string[]>(initial?.villainIds ?? []);
  const need = seats - 1;

  function toggle(id: string) {
    if (!canUseVillain(profile, id) || !isUnlocked(profile, id)) return;
    if (picks.includes(id)) setPicks(picks.filter((x) => x !== id));
    else if (picks.length < need) setPicks([...picks, id]);
  }

  function fillPreset(ids: string[]) {
    setPicks(ids.slice(0, need));
    if (ids.length + 1 !== seats) setSeats((ids.length + 1 === 2 || ids.length + 1 === 4 ? ids.length + 1 : 6) as 2 | 4 | 6);
  }

  const room: RoomConfig = { name: name.trim() || "캐시 테이블", seats, buyInBb, autoRebuy, speed, villainIds: picks };

  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn glass" onClick={onBack}>뒤로</button>
        <div className="eyebrow">방 만들기</div>
        <span />
      </div>
      <div className="card">
        <div className="row"><span className="idx">01</span><b>방 이름</b></div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="캐시 테이블"
          style={{ width: "100%", marginTop: 8, background: "#12141a", border: "1px solid #333", color: "inherit", padding: 10, borderRadius: 10 }}
        />
      </div>
      <div className="card">
        <div className="row"><span className="idx">02</span><b>인원</b></div>
        <div className="grid3" style={{ marginTop: 8 }}>
          {([2, 4, 6] as const).map((n) => (
            <button key={n} className={`sel ${seats === n ? "on" : ""}`} onClick={() => { setSeats(n); setPicks((cur) => cur.slice(0, n - 1)); }}>
              {n === 2 ? "헤즈업" : n === 4 ? "4맥스" : "6맥스"}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row"><span className="idx">03</span><b>바이인</b></div>
        <p className="kicker">연습 칩입니다. 현금이 오가지 않습니다. 블라인드는 0.5/1bb.</p>
        <div className="grid3" style={{ marginTop: 8 }}>
          {([50, 100, 200] as const).map((n) => (
            <button key={n} className={`sel ${buyInBb === n ? "on" : ""}`} onClick={() => setBuyInBb(n)}>{n}bb</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row"><span className="idx">04</span><b>리바이</b></div>
        <div className="grid2" style={{ marginTop: 8 }}>
          <button className={`sel ${autoRebuy ? "on" : ""}`} onClick={() => setAutoRebuy(true)}>연습 · 자동 리바이</button>
          <button className={`sel ${!autoRebuy ? "on" : ""}`} onClick={() => setAutoRebuy(false)}>챌린지 · 버스트 종료</button>
        </div>
      </div>
      <div className="card">
        <div className="row"><span className="idx">05</span><b>속도</b></div>
        <input type="range" min={0.7} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      </div>
      <div className="card">
        <div className="row"><span className="idx">06</span><b>상대 {picks.length}/{need}</b></div>
        <p className="kicker">프리셋으로 채우거나 직접 고르세요.</p>
        <div className="grid2" style={{ marginTop: 8 }}>
          {PRESETS.map((p) => (
            <button key={p.id} className="sel" onClick={() => fillPreset([...p.villains])}>{p.name}</button>
          ))}
        </div>
        <div className="villain-grid" style={{ marginTop: 10 }}>
          {VILLAINS.map((v) => {
            const on = picks.includes(v.id);
            const lock = !canUseVillain(profile, v.id);
            return (
              <button key={v.id} className={`vcell ${lock ? "lock" : ""} ${on ? "sel on" : ""}`} disabled={lock} onClick={() => toggle(v.id)}>
                <Avatar id={v.id} />
                <div className="name">{v.name}</div>
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="btn launch wide"
        disabled={picks.length !== need}
        onClick={() => onCreate(room, picks)}
      >
        {buyInBb}bb · {seats}인 방 열기
      </button>
    </section>
  );
}
