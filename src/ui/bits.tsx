import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Screen } from "../state/store";
export type { Screen };
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

function dollarsFromChips(chips: number): string {
  const value = Math.round((chips / 100) * 100) / 100;
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2).replace(/0$/, "");
}

/** Table values are stored as cent-like practice chips. */
export function bb(chips: number): string {
  return "$" + dollarsFromChips(chips);
}

/** Session and review values are stored in big blinds. */
export function signedBb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const body = Math.abs(rounded) % 1 === 0 ? Math.abs(rounded).toFixed(0) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${body}bb`;
}

function NavIcon({ id }: { id: "home" | "dex" | "analyze" | "settings" }) {
  const common = { width: 21, height: 21, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (id === "home") return <svg {...common} aria-hidden="true"><path d="m3.5 10 8.5-7 8.5 7v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M9 21v-7h6v7"/></svg>;
  if (id === "dex") return <svg {...common} aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6"/><path d="M14.5 14.6c3.5-.8 5.5 1 6 4.4"/></svg>;
  if (id === "analyze") return <svg {...common} aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
  return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>;
}

export function Nav({ screen, go, hidden }: { screen: Screen; go: (s: Screen) => void; hidden?: boolean }) {
  if (hidden) return null;
  const items: { id: "home" | "dex" | "analyze" | "settings"; label: string }[] = [
    { id: "home", label: "홈" },
    { id: "dex", label: "상대" },
    { id: "analyze", label: "기록" },
    { id: "settings", label: "설정" },
  ];
  return (
    <nav className="nav" aria-label="주요 메뉴">
      {items.map((it) => {
        const active = screen === it.id;
        return (
          <button key={it.id} className={active ? "on" : ""} aria-current={active ? "page" : undefined} onClick={() => go(it.id)}>
            <NavIcon id={it.id} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="stars">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}
