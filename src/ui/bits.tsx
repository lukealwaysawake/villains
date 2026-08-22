import type { Card } from "../engine/types";
import { RANK_GLYPH, SUIT_GLYPH, isRed } from "../engine/cards";
import { chipsToBb } from "../engine/types";
import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Screen } from "../state/store";

export function PlayingCard({ card, hidden, large }: { card?: Card | null; hidden?: boolean; large?: boolean }) {
  if (!card || hidden) return <div className={`pcard back ${large ? "lg" : ""}`} />;
  return (
    <div className={`pcard ${isRed(card) ? "red" : ""} ${large ? "lg" : ""}`}>
      <span>{RANK_GLYPH[card.rank]}</span>
      <span>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

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

export function bb(n: number): string {
  const v = typeof n === "number" && n > 50 ? chipsToBb(n) : n;
  const r = Math.round(v * 10) / 10;
  return `${r % 1 === 0 ? r.toFixed(0) : r}bb`;
}

export function signedBb(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}bb`;
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
