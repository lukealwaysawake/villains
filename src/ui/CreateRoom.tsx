import { useState } from "react";
import { PRESETS, VILLAINS } from "../villains/catalog";
import { canUseVillain, defaultRoom, isUnlocked, type Profile, type RoomConfig } from "../state/store";
import { Avatar } from "./bits";

const STAKES = [
  { sb: 0.5, bb: 1, label: "$0.5 / $1" },
  { sb: 1, bb: 2, label: "$1 / $2" },
  { sb: 2, bb: 5, label: "$2 / $5" },
  { sb: 5, bb: 10, label: "$5 / $10" },
];
const STARTS = [50, 100, 200, 500];
const LIMITS = [
  { n: 1, label: "1회" },
  { n: 2, label: "2회" },
  { n: 3, label: "3회" },
  { n: 0, label: "무제한" },
];

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
  const base = defaultRoom(initial);
  const [name, setName] = useState(base.name);
  const [seats, setSeats] = useState<2 | 4 | 6>(base.seats);
  const [sb, setSb] = useState(base.sb);
  const [bb, setBb] = useState(base.bb);
  const [startStack, setStartStack] = useState(base.startStack);
  const [buyInLimit, setBuyInLimit] = useState(base.buyInLimit);
  const [autoRebuy, setAutoRebuy] = useState(base.autoRebuy);
  const [speed, setSpeed] = useState(base.speed);
  const [picks, setPicks] = useState<string[]>(base.villainIds ?? ["uncleho", "nitlee", "stationpark"].slice(0, (base.seats || 4) - 1));
  const need = seats - 1;
  const buyInBb = Math.max(20, Math.round(startStack / bb)) as 50 | 100 | 200;

  function toggle(id: string) {
    if (!canUseVillain(profile, id) || !isUnlocked(profile, id)) return;
    if (picks.includes(id)) setPicks(picks.filter((x) => x !== id));
    else if (picks.length < need) setPicks([...picks, id]);
  }

  function fillPreset(ids: string[]) {
    setPicks(ids.slice(0, need));
    if (ids.length + 1 !== seats) setSeats((ids.length + 1 === 2 || ids.length + 1 === 4 ? ids.length + 1 : 6) as 2 | 4 | 6);
  }

  const room: RoomConfig = {
    name: name.trim() || "캐시 테이블",
    seats,
    buyInBb: ([50, 100, 200].includes(buyInBb) ? buyInBb : 100) as 50 | 100 | 200,
    sb,
    bb,
    startStack,
    buyInLimit,
    autoRebuy,
    speed,
    villainIds: picks,
  };

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
        <div className="row"><span className="idx">03</span><b>스몰 / 빅</b></div>
        <p className="kicker">연습 칩입니다. 현금이 오가지 않습니다. 표시만 $입니다.</p>
        <div className="grid2" style={{ marginTop: 8 }}>
          {STAKES.map((s) => (
            <button key={s.label} className={`sel ${sb === s.sb && bb === s.bb ? "on" : ""}`} onClick={() => { setSb(s.sb); setBb(s.bb); }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row"><span className="idx">04</span><b>시작 스택</b></div>
        <div className="grid2" style={{ marginTop: 8 }}>
          {STARTS.map((n) => (
            <button key={n} className={`sel ${startStack === n ? "on" : ""}`} onClick={() => setStartStack(n)}>
              ${n} · {Math.round(n / bb)}bb
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row"><span className="idx">05</span><b>바이인 횟수</b></div>
        <div className="grid2" style={{ marginTop: 8 }}>
          {LIMITS.map((x) => (
            <button key={x.label} className={`sel ${buyInLimit === x.n ? "on" : ""}`} onClick={() => { setBuyInLimit(x.n); if (x.n === 1) setAutoRebuy(false); else setAutoRebuy(true); }}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="kicker">{buyInLimit === 1 ? "한 번 사서 끝나면 세션 종료." : buyInLimit === 0 ? "스택이 블라인드 아래로 떨어지면 다시 삽니다." : `처음 포함 ${buyInLimit}번까지 살 수 있습니다.`}</p>
      </div>
      <div className="card">
        <div className="row"><span className="idx">06</span><b>속도</b></div>
        <input type="range" min={0.7} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      </div>
      <div className="card">
        <div className="row"><span className="idx">07</span><b>상대 {picks.length}/{need}</b></div>
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
        ${sb}/{bb} · 시작 ${startStack} · {seats}인 열기
      </button>
    </section>
  );
}
