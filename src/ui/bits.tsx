import { chipsToBb } from "../engine/types";
import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Screen } from "../state/store";
export { PlayingCard, ChipStack } from "./PlayingCard";

export function Avatar({ id, size = "sm" }: { id: string; size?: "sm" | "lg" }) {
  if (id === "hero") {
    return (
      <div className={`avatar ${size === "lg" ? "lg" : ""}`} style={{ background: "#2a2418", color: "#ead28a" }}>
        나
      </div>
    );
  }
  const v = VILLAIN_BY_ID[id];
  return (
    <div className={`avatar ${size === "lg" ? "lg" : ""}`} style={{ background: v.color, color: "#1a140c", ["--c" as string]: v.accent }}>
      <span className="ring" />
      {v.mark}
    </div>
  );
}

function dollars(n: number): string {
  const v = Math.abs(n) > 25 ? n / 100 : n;
  const r = Math.round(v * 100) / 100;
  if (r % 1 === 0) return String(r);
  return r.toFixed(2).replace(/0$/, "");
}

export function bb(n: number): string {
  return "$" + dollars(n);
}

export function signedBb(n: number): string {
  const v = Math.abs(n) > 25 ? n / 100 : n;
  const r = Math.round(v * 100) / 100;
  const body = r % 1 === 0 ? String(Math.abs(r)) : Math.abs(r).toFixed(2).replace(/0$/, "");
  return `${r > 0 ? "+$" : r < 0 ? "-$" : "$"}${body}`;
}

export function Nav({ screen, go, hidden }: { screen: Screen; go: (s: Screen) => void; hidden?: boolean }) {
  if (hidden) return null;
  const items: { id: Screen; label: string; icon: string }[] = [
    { id: "home", label: "홈", icon: "V" },
    { id: "dex", label: "도감", icon: "15" },
    { id: "reviews", label: "리뷰", icon: "R" },
    { id: "settings", label: "설정", icon: "·" },
  ];
  return (
    <nav className="nav">
      {items.map((it) => (
        <button key={it.id} className={screen === it.id ? "on" : ""} onClick={() => go(it.id)}>
          <b>{it.icon}</b>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}
