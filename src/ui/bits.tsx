import type { CSSProperties, KeyboardEvent } from "react";
import { VILLAIN_BY_ID } from "../villains/catalog";
import type { Screen } from "../state/store";
import { bbToDollars, formatSignedDollars } from "./money";
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

/** Session and review values are stored in big blinds. Convert only when the room's dollar BB is known. */
export function signedBb(value: number, bigBlindDollars?: number): string {
  return formatSignedDollars(bbToDollars(value, bigBlindDollars));
}

/** Convert bb-based help copy using the selected room's dollar big blind. */
export function bbCopyToDollars(text: string, bigBlindDollars: number): string {
  return text.replace(/([+−-]?)(\d+(?:\.\d+)?)bb/g, (_match, sign: string, amount: string) => {
    const dollars = Number(amount) * bigBlindDollars;
    const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2).replace(/0$/, "");
    return `${sign === "-" ? "−" : sign}$${body}`;
  });
}

/** Convert a bb/100 target string using the selected room's dollar big blind. */
export function bb100CopyToDollars(text: string, bigBlindDollars: number): string {
  return text.replace(/([+−-]?)(\d+(?:\.\d+)?)/g, (_match, sign: string, amount: string) => {
    const dollars = Number(amount) * bigBlindDollars;
    const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2).replace(/0$/, "");
    return `${sign === "-" ? "−" : sign}$${body}`;
  });
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  detail?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  columns = options.length,
  className = "",
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  columns?: number;
  className?: string;
}) {
  const activeIndex = options.findIndex((option) => option.value === value);
  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
    const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
    if (!horizontal && !vertical && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(event.currentTarget);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    buttons[next]?.click();
  }
  return (
    <div
      className={`control-group ${className}`.trim()}
      role="radiogroup"
      aria-label={label}
      style={{ "--segments": columns } as CSSProperties}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            type="button"
            key={String(option.value)}
            role="radio"
            aria-checked={active}
            className={active ? "on" : ""}
            disabled={option.disabled}
            tabIndex={active || (activeIndex < 0 && index === 0) ? 0 : -1}
            onKeyDown={move}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedActions<T extends string | number>({
  label,
  activeValue,
  options,
  onAction,
  columns = options.length,
  className = "",
}: {
  label: string;
  activeValue?: T;
  options: SegmentOption<T>[];
  onAction: (value: T) => void;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={`control-group ${className}`.trim()}
      role="group"
      aria-label={label}
      style={{ "--segments": columns } as CSSProperties}
    >
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          aria-pressed={option.value === activeValue}
          disabled={option.disabled}
          onClick={() => onAction(option.value)}
        >
          <span>{option.label}</span>
          {option.detail && <small>{option.detail}</small>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  onBack,
  backLabel = "이전 화면으로 돌아가기",
  titleAs = "h1",
}: {
  eyebrow: string;
  title: string;
  onBack?: () => void;
  backLabel?: string;
  titleAs?: "h1" | "span";
}) {
  const Title = titleAs;
  return (
    <header className="page-header">
      {onBack ? <button className="icon-button" type="button" onClick={onBack} aria-label={backLabel}>‹</button> : <span className="header-spacer" />}
      <div><span className="eyebrow">{eyebrow}</span><Title className="page-header-title">{title}</Title></div>
      <span className="header-spacer" />
    </header>
  );
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
