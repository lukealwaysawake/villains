import { createFairness, type FairnessRecord } from "../engine/fairness";
import { createFreshPlayers, startHand, type TableState } from "../engine/game";
import { chipsToBb } from "../engine/types";
import { PRESETS, STARTER_UNLOCKS, VILLAIN_BY_ID, VILLAINS } from "../villains/catalog";
import { createRuntime, type VillainRuntime } from "../villains/types";
import { detectPatterns, type ReviewCard } from "../review/analyze";

export type Screen = "home" | "lobby" | "table" | "report" | "dex" | "detail" | "reviews" | "settings" | "onboarding" | "fairness";
export type HudMode = "learn" | "standard" | "split" | "off";
export type ReviewPause = "off" | "red" | "yellow" | "all";

export interface Settings {
  hudMode: HudMode;
  reviewPause: ReviewPause;
  tellDifficulty: number;
  animSpeed: number;
  unlockAll: boolean;
  isPro: boolean;
}

export interface Mastery {
  handsPlayed: number;
  bb: number;
  exploitHits: number;
  exploitChances: number;
  leaksFound: string[];
  hintsUsed: boolean;
}

export interface HeroStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  threeBetOpp: number;
  aggBet: number;
  aggCall: number;
  wtsd: number;
  sawFlop: number;
}

export interface Session {
  id: string;
  presetId?: string;
  villainIds: string[];
  seed: string;
  seedClient: string;
  seedServerHash: string;
  handNumber: number;
  button: number;
  stacks: Record<string, number>;
  bbDelta: number;
  handsPlayed: number;
  heroStats: HeroStats;
  runtimes: Record<string, VillainRuntime>;
  reviews: ReviewCard[];
  heroFoldStreak: number;
  startedAt: number;
  fairness?: FairnessRecord;
  l2Used: number;
  tutorial: boolean;
  missedExploits: number;
  coachOn: boolean;
}

export interface Profile {
  onboardingDone: boolean;
  unlocked: string[];
  mastery: Record<string, Mastery>;
  reviewQueue: ReviewCard[];
  lifetimeHands: number;
  settings: Settings;
  lastSession?: Session;
  savedCombos: { name: string; ids: string[] }[];
  daily: { date: string; hands: number };
  firstReviewDone: boolean;
}

const KEY = "villains.v1";

export const defaultSettings = (): Settings => ({
  hudMode: "standard",
  reviewPause: "off",
  tellDifficulty: 0.78,
  animSpeed: 1,
  unlockAll: false,
  isPro: false,
});

export function emptyMastery(): Mastery {
  return { handsPlayed: 0, bb: 0, exploitHits: 0, exploitChances: 0, leaksFound: [], hintsUsed: false };
}

export function defaultProfile(): Profile {
  return {
    onboardingDone: false,
    unlocked: [...STARTER_UNLOCKS],
    mastery: Object.fromEntries(VILLAINS.map((v) => [v.id, emptyMastery()])),
    reviewQueue: [],
    lifetimeHands: 0,
    settings: defaultSettings(),
    savedCombos: [],
    daily: { date: todayKey(), hands: 0 },
    firstReviewDone: false,
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<Profile>;
    const base = defaultProfile();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      mastery: { ...base.mastery, ...(parsed.mastery ?? {}) },
      daily: parsed.daily ?? base.daily,
      savedCombos: parsed.savedCombos ?? [],
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function isUnlocked(profile: Profile, id: string): boolean {
  if (profile.settings.unlockAll) return true;
  return profile.unlocked.includes(id);
}

export function masteryPct(m: Mastery, expected = 15): number {
  if (m.handsPlayed <= 0) return 0;
  const edge = Math.max(0, (m.bb / Math.max(1, m.handsPlayed)) * 100);
  const acc = m.exploitChances ? (m.exploitHits / m.exploitChances) * 100 : 0;
  const vol = Math.min(40, (m.handsPlayed / 200) * 40);
  return Math.max(0, Math.min(99, Math.round(vol + Math.min(35, (edge / expected) * 25) + acc * 0.25 + m.leaksFound.length * 8)));
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export const FREE_VILLAINS = ["uncleho", "nitlee", "stationpark", "foldjeong", "weekend", "bulldozer"];

export function isPro(profile: Profile): boolean {
  return profile.settings.isPro || profile.settings.unlockAll;
}

export function remainingDailyHands(profile: Profile): number {
  if (isPro(profile)) return 99999;
  const d = profile.daily.date === todayKey() ? profile.daily.hands : 0;
  return Math.max(0, 300 - d);
}

export function canUseVillain(profile: Profile, id: string): boolean {
  if (!isUnlocked(profile, id)) return false;
  if (isPro(profile)) return true;
  return FREE_VILLAINS.includes(id);
}

export function canUsePreset(profile: Profile, presetId: string): boolean {
  if (isPro(profile)) return true;
  return presetId === "intro";
}

export function createSession(villainIds: string[], presetId?: string, opts?: { tutorial?: boolean; seedClient?: string }): Session {
  const fair = createFairness(opts?.seedClient);
  const ids = ["hero", ...villainIds];
  const players = createFreshPlayers(ids);
  const stacks = Object.fromEntries(players.map((p) => [p.id, p.stack]));
  const runtimes = Object.fromEntries(villainIds.map((id, i) => [id, createRuntime(id, i + 1)]));
  return {
    id: fair.finalSeed,
    presetId,
    villainIds,
    seed: fair.finalSeed,
    seedClient: fair.seedClient,
    seedServerHash: fair.seedServerHash,
    handNumber: 0,
    button: 0,
    stacks,
    bbDelta: 0,
    handsPlayed: 0,
    heroStats: { hands: 0, vpip: 0, pfr: 0, threeBet: 0, threeBetOpp: 0, aggBet: 0, aggCall: 0, wtsd: 0, sawFlop: 0 },
    runtimes,
    reviews: [],
    heroFoldStreak: 0,
    startedAt: Date.now(),
    fairness: fair,
    l2Used: 0,
    tutorial: !!opts?.tutorial,
    missedExploits: 0,
    coachOn: !!opts?.tutorial,
  };
}

export function dealNext(session: Session): TableState {
  session.handNumber += 1;
  session.button = (session.button + 1) % (session.villainIds.length + 1);
  const ids = ["hero", ...session.villainIds];
  const players = createFreshPlayers(ids).map((p) => ({ ...p, stack: session.stacks[p.id] ?? p.stack }));
  return startHand({
    players,
    button: session.button,
    handNumber: session.handNumber,
    seed: session.seed,
  });
}

export function commitHand(profile: Profile, session: Session, state: TableState, review: ReviewCard): void {
  for (const p of state.players) session.stacks[p.id] = p.stack;
  const delta = chipsToBb(state.result?.heroDelta ?? 0);
  session.bbDelta += delta;
  session.handsPlayed += 1;
  session.heroStats.hands += 1;
  const heroActs = state.actionLog.filter((a) => a.actorId === "hero");
  const vp = heroActs.some((a) => a.street === "preflop" && a.type !== "fold");
  const pr = heroActs.some((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet" || a.type === "allin"));
  if (vp) session.heroStats.vpip += 1;
  if (pr) session.heroStats.pfr += 1;
  const facedOpen = state.actionLog.some((a) => a.actorId !== "hero" && a.street === "preflop" && (a.type === "raise" || a.type === "bet"));
  if (facedOpen) session.heroStats.threeBetOpp += 1;
  if (facedOpen && heroActs.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin")).length >= 1 && pr) {
    const hero3 = heroActs.some((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin") && a.toCall >= 100);
    if (hero3) session.heroStats.threeBet += 1;
  }
  session.heroStats.aggBet += heroActs.filter((a) => a.type === "bet" || a.type === "raise" || a.type === "allin").length;
  session.heroStats.aggCall += heroActs.filter((a) => a.type === "call").length;
  if (state.board.length >= 3 && !state.players[0].folded) session.heroStats.sawFlop += 1;
  if (state.result?.shown[0]) session.heroStats.wtsd += 1;
  if (review.severity !== "green" && review.leak) session.missedExploits += 1;
  if (profile.daily.date !== todayKey()) profile.daily = { date: todayKey(), hands: 0 };
  profile.daily.hands += 1;
  if (heroActs[0]?.type === "fold" && heroActs.length === 1) session.heroFoldStreak += 1;
  else session.heroFoldStreak = 0;

  session.reviews.push(review);
  if (!review.viewed && review.severity !== "green") profile.reviewQueue.unshift(review);
  profile.lifetimeHands += 1;

  for (const id of session.villainIds) {
    const m = profile.mastery[id] ?? emptyMastery();
    m.handsPlayed += 1;
    const villainDelta = state.result?.deltas[id] ?? 0;
    m.bb += -chipsToBb(villainDelta);
    if (review.villainId === id && review.leak) {
      m.exploitChances += 1;
      if (review.severity === "green") m.exploitHits += 1;
    }
    profile.mastery[id] = m;
  }

  refreshUnlocks(profile);
  profile.lastSession = session;
  saveProfile(profile);
}

export function markLeakFound(profile: Profile, villainId: string, leak: string): void {
  const m = profile.mastery[villainId] ?? emptyMastery();
  if (!m.leaksFound.includes(leak)) m.leaksFound.push(leak);
  profile.mastery[villainId] = m;
  saveProfile(profile);
}

export function refreshUnlocks(profile: Profile): void {
  const hands = profile.lifetimeHands;
  const add = (id: string) => {
    if (!profile.unlocked.includes(id)) profile.unlocked.push(id);
  };
  if (hands >= 0) STARTER_UNLOCKS.forEach(add);
  if (hands >= 200) ["foldjeong", "weekend", "bulldozer"].forEach(add);
  const cReady = ["uncleho", "nitlee", "stationpark", "foldjeong", "weekend", "bulldozer", "tourneymin", "vendetta", "slowroll"].filter(
    (id) => (profile.mastery[id]?.handsPlayed ?? 0) >= 80 || masteryPct(profile.mastery[id] ?? emptyMastery()) >= 40,
  );
  if (cReady.length >= 3) ["madamj", "tourneymin", "vendetta", "slowroll"].forEach(add);
  const bMastered = ["nitlee", "stationpark", "madamj", "bulldozer", "foldjeong"].filter(
    (id) => masteryPct(profile.mastery[id] ?? emptyMastery()) >= 60,
  );
  if (bMastered.length >= 3) ["songtag", "irongate", "ceokim"].forEach(add);
  const aPlus = ["songtag", "irongate", "ceokim"].every((id) => {
    const m = profile.mastery[id];
    return m && m.handsPlayed >= 80 && m.bb > 0;
  });
  if (aPlus) add("professor");
  if ((profile.mastery.professor?.handsPlayed ?? 0) >= 200) add("greatwhite");
}

export function sessionPatterns(session: Session) {
  return detectPatterns(session.reviews);
}

export function presetById(id: string) {
  return PRESETS.find((p) => p.id === id);
}

export function villainName(id: string) {
  return VILLAIN_BY_ID[id]?.name ?? id;
}
VILLAIN_BY_ID[id]?.name ?? id;
}
