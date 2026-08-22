import { useState } from "react";
import { PRESETS, VILLAINS, VILLAIN_BY_ID } from "../villains/catalog";
import { defaultRoom, type RoomConfig } from "../state/store";
import { Avatar, PageHeader, Segmented, SegmentedActions } from "./bits";

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

function MoneyField({ value, onChange, label, step = 0.5 }: { value: number; onChange: (n: number) => void; label: string; step?: number }) {
  return (
    <label className="cash-field">
      <span>{label}</span>
      <span className="cash-in">
        <span aria-hidden="true">$</span>
        <input
          aria-label={label}
          type="number"
          inputMode="decimal"
          min={0.01}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        />
      </span>
    </label>
  );
}

export function CreateRoom({
  initial,
  onBack,
  onCreate,
}: {
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
  const [picks, setPicks] = useState<string[]>(base.villainIds ?? ["uncleho", "nitlee", "stationpark"].slice(0, base.seats - 1));

  const need = seats - 1;
  const selected = picks.slice(0, need);
  const rawBuyInBb = Math.round((startStack || 1) / Math.max(bb, 0.01));
  const buyInBb = (rawBuyInBb >= 200 ? 200 : rawBuyInBb >= 100 ? 100 : 50) as 50 | 100 | 200;
  const ready = selected.length === need && sb > 0 && bb >= sb && startStack >= bb;
  const missing = Math.max(0, need - selected.length);
  const readyReason = missing > 0 ? `상대 ${missing}명을 더 고르세요` : sb <= 0 || bb < sb ? "블라인드 금액을 확인하세요" : startStack < bb ? "바이인은 빅 블라인드보다 커야 합니다" : "";
  const speedLabel = speed < 0.9 ? "느리게" : speed > 1.3 ? "빠르게" : "보통";

  function setSmall(n: number) {
    setSb(n);
    if (bb === sb * 2 || bb < n) setBb(Math.round(n * 2 * 100) / 100);
  }

  function changeSeats(n: 2 | 4 | 6) {
    setSeats(n);
    setPicks((current) => current.slice(0, n - 1));
  }

  function toggle(id: string) {
    if (selected.includes(id)) setPicks(selected.filter((x) => x !== id));
    else if (selected.length < need) setPicks([...selected, id]);
  }

  function fillPreset(ids: readonly string[]) {
    const targetSeats = ids.length + 1 <= 2 ? 2 : ids.length + 1 <= 4 ? 4 : 6;
    setSeats(targetSeats);
    setPicks([...ids].slice(0, targetSeats - 1));
  }

  const room: RoomConfig = {
    name: name.trim() || "캐시 테이블",
    seats,
    buyInBb,
    sb,
    bb,
    startStack,
    buyInLimit,
    autoRebuy,
    speed,
    villainIds: selected,
  };

  return (
    <div className="room-layout">
      <section className="room-scroll">
      <PageHeader eyebrow="NEW TABLE" title="테이블 만들기" onBack={onBack} backLabel="홈으로 돌아가기" />
      <p className="page-lead">인원과 상대만 고르면 바로 시작합니다. 추천값은 언제든 바꿀 수 있어요.</p>

      <section className="form-section" aria-labelledby="players-title">
        <div className="form-heading">
          <div><span className="step">01</span><h2 id="players-title">인원</h2></div>
          <span className="form-value">나 포함 {seats}명</span>
        </div>
        <Segmented
          label="테이블 인원"
          value={seats}
          options={[
            { value: 2, label: "헤즈업" },
            { value: 4, label: "4맥스" },
            { value: 6, label: "6맥스" },
          ]}
          onChange={changeSeats}
        />
      </section>

      <section className="form-section" aria-labelledby="game-title">
        <div className="form-heading">
          <div><span className="step">02</span><h2 id="game-title">게임 금액</h2></div>
          <span className="form-value">연습 칩</span>
        </div>
        <label className="field-label">블라인드</label>
        <Segmented
          label="블라인드"
          value={`${sb}/${bb}`}
          options={STAKES.map((stake) => ({ value: `${stake.sb}/${stake.bb}`, label: stake.label }))}
          onChange={(next) => {
            const stake = STAKES.find((item) => `${item.sb}/${item.bb}` === next);
            if (stake) { setSb(stake.sb); setBb(stake.bb); }
          }}
          columns={4}
        />
        <label className="field-label">바이인</label>
        <Segmented
          label="시작 바이인"
          value={startStack}
          options={STARTS.map((amount) => ({ value: amount, label: `$${amount}` }))}
          onChange={setStartStack}
          columns={4}
        />
        <p className="field-help">현재 ${startStack}로 시작합니다.</p>
      </section>

      <section className="form-section" aria-labelledby="opponents-title">
        <div className="form-heading">
          <div><span className="step">03</span><h2 id="opponents-title">상대</h2></div>
          <span className={`form-value ${missing ? "warn" : "good"}`}>{selected.length}/{need}</span>
        </div>
        <div className="selected-lineup" aria-label="선택한 상대">
          {selected.map((id) => <div key={id}><Avatar id={id} /><span>{VILLAIN_BY_ID[id]?.name}</span></div>)}
          {Array.from({ length: missing }, (_, i) => <div key={`empty-${i}`} className="empty-seat"><span>+</span><small>선택</small></div>)}
        </div>
        <SegmentedActions
          label="상대 추천 조합"
          activeValue={PRESETS.slice(0, 3).find((preset) => preset.villains.length === selected.length && preset.villains.every((id, index) => selected[index] === id))?.id}
          options={PRESETS.slice(0, 3).map((preset) => ({ value: preset.id, label: preset.name }))}
          onAction={(id) => {
            const preset = PRESETS.find((item) => item.id === id);
            if (preset) fillPreset(preset.villains);
          }}
          columns={3}
          className="preset-control"
        />
        <div className="villain-picker">
          {VILLAINS.map((villain) => {
            const on = selected.includes(villain.id);
            return (
              <button key={villain.id} className={on ? "on" : ""} aria-pressed={on} onClick={() => toggle(villain.id)}>
                <Avatar id={villain.id} />
                <span>{villain.name}</span>
                <small>{villain.tier}</small>
                <i aria-hidden="true">✓</i>
              </button>
            );
          })}
        </div>
      </section>

      <details className="advanced-card">
        <summary><span><b>세부 옵션</b><small>직접 입력 · 바이인 횟수 · 속도</small></span><span aria-hidden="true">+</span></summary>
        <div className="advanced-body">
          <div className="grid2">
            <MoneyField value={sb} onChange={setSmall} label="스몰 블라인드" />
            <MoneyField value={bb} onChange={setBb} label="빅 블라인드" />
          </div>
          <MoneyField value={startStack} onChange={setStartStack} label="시작 바이인" step={1} />
          <div>
            <label className="field-label">바이인 횟수</label>
            <Segmented
              label="바이인 횟수"
              value={buyInLimit}
              options={LIMITS.map((item) => ({ value: item.n, label: item.label }))}
              onChange={(next) => { setBuyInLimit(next); setAutoRebuy(next !== 1); }}
              columns={4}
            />
          </div>
          <button className={`toggle-row ${autoRebuy ? "on" : ""}`} aria-pressed={autoRebuy} onClick={() => setAutoRebuy((value) => !value)}>
            <span><b>자동 리바이</b><small>스택이 부족하면 설정 횟수 안에서 다시 채웁니다.</small></span><i aria-hidden="true" />
          </button>
          <label className="range-field">
            <span><b>게임 속도</b><small>{speedLabel}</small></span>
            <input aria-label="게임 속도" type="range" min={0.7} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
          <label className="text-field">
            <span>테이블 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="캐시 테이블" />
          </label>
        </div>
      </details>
      </section>

      <div className="room-submit">
        {readyReason && <p role="status">{readyReason}</p>}
        <button className="btn primary wide" disabled={!ready} onClick={() => onCreate(room, selected)}>
          <span>테이블에 앉기</span>
          <small>${sb}/${bb} · ${startStack} · {seats}인</small>
        </button>
      </div>
    </div>
  );
}
