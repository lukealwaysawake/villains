import { createFairness, type FairnessRecord } from "../engine/fairness";
import { createFreshPlayers, startHand, type TableState } from "../engine/game";
import { chipsToBb } from "../engine/types";
import { PRESETS, STARTER_UNLOCKS, VILLAIN_BY_ID, VILLAINS } from "../villains/catalog";
import { createRuntime, type VillainRuntime } from "../villains/types";
import { detectPatterns, type ReviewCard } from "../review/analyze";
import type { DecisionSnapshot } from "../review/ev";
import {
  createPatternAggregate,
  decisionNeedsMoreSamples,
  summarizeSession as summarizeCoachingDecisions,
  updatePatternAggregate,
  type DecisionAnalysis,
  type PatternAggregate,
  type SessionCoachingSummary,
  type SkillKey,
} from "../review/learning";

export type Screen = "home" | "lobby" | "table" | "report" | "dex" | "detail" | "reviews" | "settings" | "onboarding" | "fairness" | "history" | "create-room" | "analyze";
export interface RoomConfig {
  name: string;
  seats: 2 | 4 | 6;
  buyInBb: 50 | 100 | 200;
  sb: number;
  bb: number;
  startStack: number;
  buyInLimit: number;
  autoRebuy: boolean;
  speed: number;
  villainIds?: string[];
}

export function defaultRoom(partial: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: "캐시 테이블",
    seats: 4,
    buyInBb: 100,
    sb: 0.5,
    bb: 1,
    startStack: 100,
    buyInLimit: 0,
    autoRebuy: true,
    speed: 1,
    ...partial,
  };
}

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
  sessionsPlayed: number;
  bb: number;
  dollarDelta: number;
  dollarHands: number;
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
  liveTable?: TableState | null;
  pendingDecisions?: DecisionSnapshot[];
  room?: RoomConfig;
  buyInChips: number;
  heroBuyIns: number;
  buyIns?: Record<string, number>;
}

export interface Profile {
  schemaVersion: 2;
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
  sessionHistory: SessionSummary[];
  handLog: HandLog[];
  habits: HabitRecord[];
  lastRoom?: { room: RoomConfig; villainIds: string[]; at: number };
  learning: LearningState;
}

export interface AnalysisJob {
  id: string;
  sessionId: string;
  handNumber: number;
  review: ReviewCard;
  decisions: DecisionSnapshot[];
  tellDifficulty: number;
  createdAt: number;
}

export interface SkillAggregate {
  skill: SkillKey;
  opportunities: number;
  misses: number;
  totalLossBb: number;
  weightedScoreSum: number;
  weightSum: number;
  seenDecisionIds: string[];
  recentScores: number[];
}

export interface LearningState {
  schemaVersion: 2;
  recentDecisions: DecisionAnalysis[];
  patterns: Record<string, PatternAggregate>;
  skills: Partial<Record<SkillKey, SkillAggregate>>;
  pendingJobs: AnalysisJob[];
  legacyHabitCount: number;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  presetId?: string;
  villainIds: string[];
  handsPlayed: number;
  bbDelta: number;
  bigBlindDollars?: number;
  vpip: number;
  pfr: number;
  coaching?: SessionCoachingSummary;
}

export interface HandLog {
  at: number;
  sessionId: string;
  handNumber: number;
  heroDelta: number;
  bigBlindDollars?: number;
  severity: string;
  headline: string;
  leak?: string;
  villainId?: string;
}

export interface HabitRecord {
  tag: string;
  leak?: string;
  count: number;
  totalLossBb: number;
  totalLossDollars?: number;
  lastAt: number;
  villains: string[];
  examples: { at: number; handNumber: number; body: string; loss: number; lossDollars?: number }[];
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
  return { handsPlayed: 0, sessionsPlayed: 0, bb: 0, dollarDelta: 0, dollarHands: 0, exploitHits: 0, exploitChances: 0, leaksFound: [], hintsUsed: false };
}

export function defaultProfile(): Profile {
  return {
    schemaVersion: 2,
    onboardingDone: false,
    unlocked: [...STARTER_UNLOCKS],
    mastery: Object.fromEntries(VILLAINS.map((v) => [v.id, emptyMastery()])),
    reviewQueue: [],
    lifetimeHands: 0,
    settings: defaultSettings(),
    savedCombos: [],
    daily: { date: todayKey(), hands: 0 },
    firstReviewDone: false,
    sessionHistory: [],
    handLog: [],
    habits: [],
    learning: defaultLearningState(),
  };
}

export function defaultLearningState(legacyHabitCount = 0): LearningState {
  return {
    schemaVersion: 2,
    recentDecisions: [],
    patterns: {},
    skills: {},
    pendingJobs: [],
    legacyHabitCount,
  };
}

function migrateLearning(value: Partial<LearningState> | null | undefined, legacyHabitCount: number): LearningState {
  const base = defaultLearningState(legacyHabitCount);
  if (!value || typeof value !== "object") return base;
  const recentDecisions = Array.isArray(value.recentDecisions)
    ? value.recentDecisions.filter((decision) => decision && typeof decision.id === "string").slice(-300)
    : [];
  const patterns = value.patterns && typeof value.patterns === "object" ? value.patterns : {};
  const skills = value.skills && typeof value.skills === "object" ? value.skills : {};
  const pendingJobs = Array.isArray(value.pendingJobs)
    ? value.pendingJobs.filter((job) => job && typeof job.id === "string" && Array.isArray(job.decisions)).slice(0, 4)
    : [];
  return {
    schemaVersion: 2,
    recentDecisions,
    patterns,
    skills,
    pendingJobs,
    legacyHabitCount: Number.isFinite(value.legacyHabitCount) ? Math.max(0, value.legacyHabitCount!) : legacyHabitCount,
  };
}

function migrateProfile(parsed: Partial<Profile>): Profile {
  const base = defaultProfile();
  const habits = Array.isArray(parsed.habits) ? parsed.habits : [];
  return {
    ...base,
    ...parsed,
    schemaVersion: 2,
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    mastery: Object.fromEntries(VILLAINS.map((villain) => [
      villain.id,
      { ...emptyMastery(), ...(parsed.mastery?.[villain.id] ?? {}) },
    ])),
    daily: parsed.daily ?? base.daily,
    savedCombos: parsed.savedCombos ?? [],
    sessionHistory: parsed.sessionHistory ?? [],
    handLog: parsed.handLog ?? [],
    habits,
    learning: migrateLearning(parsed.learning, habits.length),
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    return migrateProfile(JSON.parse(raw) as Partial<Profile>);
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function isUnlocked(_profile: Profile, _id: string): boolean {
  return true;
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

export function remainingDailyHands(_profile: Profile): number {
  return 99999;
}

export function canUseVillain(_profile: Profile, _id: string): boolean {
  return true;
}

export function canUsePreset(_profile: Profile, _presetId: string): boolean {
  return true;
}

export function createSession(villainIds: string[], presetId?: string, opts?: { tutorial?: boolean; seedClient?: string; room?: RoomConfig }): Session {
  const fair = createFairness(opts?.seedClient);
  const uniqueVillains = [...new Set(villainIds.filter((id) => id !== "hero"))];
  const room: RoomConfig = defaultRoom({
    name: presetId === "intro" ? "입문 테이블" : "캐시 테이블",
    seats: (uniqueVillains.length + 1 <= 2 ? 2 : uniqueVillains.length + 1 <= 4 ? 4 : 6),
    ...(opts?.room ?? {}),
  });
  const buyInChips = Math.round((room.startStack || room.buyInBb) * 100);
  const ids = ["hero", ...uniqueVillains].slice(0, room.seats);
  const players = createFreshPlayers(ids, buyInChips);
  const stacks = Object.fromEntries(players.map((p) => [p.id, p.stack]));
  const runtimes = Object.fromEntries(uniqueVillains.map((id, i) => [id, createRuntime(id, i + 1)]));
  return {
    id: fair.finalSeed,
    presetId,
    villainIds: ids.slice(1),
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
    pendingDecisions: [],
    room,
    buyInChips,
    heroBuyIns: 1,
    buyIns: Object.fromEntries(ids.map((id) => [id, 1])),
  };
}

function seatedIds(session: Session): string[] {
  return ["hero", ...session.villainIds];
}

function ensureBuyIns(session: Session): Record<string, number> {
  const current = session.buyIns ?? {};
  for (const id of seatedIds(session)) {
    if (current[id] === undefined) current[id] = id === "hero" ? (session.heroBuyIns ?? 1) : 1;
  }
  session.buyIns = current;
  session.heroBuyIns = current.hero ?? 1;
  return current;
}

function canPlayerContinue(session: Session, id: string): boolean {
  const room = session.room;
  const bbChip = Math.round((room?.bb ?? 1) * 100);
  if ((session.stacks[id] ?? 0) >= bbChip) return true;
  if (room?.autoRebuy === false) return false;
  const limit = room?.buyInLimit ?? 0;
  const used = ensureBuyIns(session)[id] ?? 1;
  return limit === 0 || used < limit;
}

export function continuablePlayerIds(session: Session): string[] {
  return seatedIds(session).filter((id) => canPlayerContinue(session, id));
}

export function canContinueSession(session: Session): { ok: boolean; reason: string } {
  const bbChip = Math.round((session.room?.bb ?? 1) * 100);
  const funded = seatedIds(session).filter((id) => (session.stacks[id] ?? 0) >= bbChip);
  if (funded.length === 0) return { ok: false, reason: "모든 플레이어가 탈락했습니다." };
  const ids = continuablePlayerIds(session);
  if (!ids.includes("hero")) return { ok: false, reason: "바이인이 소진됐습니다." };
  if (ids.length < 2) return { ok: false, reason: "상대가 모두 탈락했습니다." };
  return { ok: true, reason: "" };
}

export function dealNext(session: Session): TableState {
  const continuation = canContinueSession(session);
  if (!continuation.ok) throw new Error(continuation.reason);

  const room = session.room;
  const buyIn = session.buyInChips ?? Math.round((room?.startStack ?? 100) * 100);
  const bbChip = Math.round((room?.bb ?? 1) * 100);
  const usage = ensureBuyIns(session);
  const ids = continuablePlayerIds(session);
  const players = createFreshPlayers(ids, buyIn).map((player) => {
    let stack = session.stacks[player.id] ?? buyIn;
    if (stack < bbChip) {
      stack = buyIn;
      usage[player.id] = (usage[player.id] ?? 1) + 1;
      session.stacks[player.id] = stack;
    }
    return { ...player, stack };
  });

  session.heroBuyIns = usage.hero ?? 1;
  session.handNumber += 1;
  if (session.handNumber > 1) session.button = (session.button + 1) % players.length;
  else session.button %= players.length;

  return startHand({
    players,
    button: session.button,
    handNumber: session.handNumber,
    seed: session.seed,
    buyIn,
    autoRebuy: false,
    sb: Math.round((room?.sb ?? 0.5) * 100),
    bb: bbChip,
  });
}

export function commitHand(profile: Profile, session: Session, state: TableState, review: ReviewCard): void {
  if (session.reviews.some((item) => item.id === review.id)) return;
  session.pendingDecisions = [];
  for (const p of state.players) session.stacks[p.id] = p.stack;
  const delta = chipsToBb(state.result?.heroDelta ?? 0, state.bb);
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
    const hero3 = heroActs.some((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin") && a.toCall >= state.bb);
    if (hero3) session.heroStats.threeBet += 1;
  }
  session.heroStats.aggBet += heroActs.filter((a) => a.type === "bet" || a.type === "raise" || a.type === "allin").length;
  session.heroStats.aggCall += heroActs.filter((a) => a.type === "call").length;
  if (state.board.length >= 3 && !state.players[0].folded) session.heroStats.sawFlop += 1;
  if (state.result?.shown[0]) session.heroStats.wtsd += 1;
  if (!review.analysisStatus && review.severity !== "green" && review.leak) session.missedExploits += 1;
  if (profile.daily.date !== todayKey()) profile.daily = { date: todayKey(), hands: 0 };
  profile.daily.hands += 1;
  if (heroActs[0]?.type === "fold" && heroActs.length === 1) session.heroFoldStreak += 1;
  else session.heroFoldStreak = 0;

  session.reviews.push(review);
  if (review.analysisStatus !== "preliminary" && !review.viewed && review.severity !== "green") {
    profile.reviewQueue.unshift(review);
    profile.reviewQueue = profile.reviewQueue.slice(0, 80);
  }
  profile.lifetimeHands += 1;
  profile.handLog = [
    {
      at: Date.now(),
      sessionId: session.id,
      handNumber: session.handNumber,
      heroDelta: delta,
      bigBlindDollars: state.bb / 100,
      severity: review.severity,
      headline: review.headline,
      leak: review.leak,
      villainId: review.villainId,
    },
    ...(profile.handLog ?? []),
  ].slice(0, 200);
  if (!review.analysisStatus && review.severity !== "green") {
    profile.habits = recordHabit(profile.habits ?? [], review);
  }

  for (const id of session.villainIds.filter((villainId) => state.players.some((player) => player.id === villainId))) {
    const m = profile.mastery[id] ?? emptyMastery();
    m.handsPlayed += 1;
    m.dollarHands = (m.dollarHands ?? 0) + 1;
    const hero = state.players.find((p) => p.id === "hero");
    const villain = state.players.find((p) => p.id === id);
    const involved = state.players.filter((p) => p.id !== "hero" && p.contributedHand > 0);
    const potShare = involved.reduce((s, p) => s + p.contributedHand, 0);
    if (hero && villain && hero.contributedHand > 0 && villain.contributedHand > 0 && potShare > 0) {
      const share = villain.contributedHand / potShare;
      m.bb += delta * share;
      m.dollarDelta = (m.dollarDelta ?? 0) + delta * (state.bb / 100) * share;
    }
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

export function summarizeSession(session: Session): SessionSummary {
  const hs = session.heroStats;
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    presetId: session.presetId,
    villainIds: [...session.villainIds],
    handsPlayed: session.handsPlayed,
    bbDelta: session.bbDelta,
    bigBlindDollars: session.room?.bb,
    vpip: hs.hands ? Math.round((hs.vpip / hs.hands) * 100) : 0,
    pfr: hs.hands ? Math.round((hs.pfr / hs.hands) * 100) : 0,
    coaching: summarizeCoachingDecisions(session.reviews.flatMap((review) => review.analyses ?? [])),
  };
}

export function archiveSession(profile: Profile, session: Session | null | undefined): Profile {
  if (!session || session.handsPlayed <= 0) return profile;
  const sum = summarizeSession(session);
  const rest = (profile.sessionHistory ?? []).filter((s) => s.id !== sum.id);
  profile.sessionHistory = [sum, ...rest].slice(0, 30);
  for (const id of session.villainIds) {
    const m = profile.mastery[id] ?? emptyMastery();
    m.sessionsPlayed = (m.sessionsPlayed ?? 0) + 1;
    profile.mastery[id] = m;
  }
  session.liveTable = null;
  session.pendingDecisions = [];
  profile.lastSession = session;
  saveProfile(profile);
  return profile;
}

export function saveCombo(profile: Profile, name: string, ids: string[]): Profile {
  const next = { ...profile, savedCombos: [{ name, ids }, ...profile.savedCombos.filter((c) => c.name !== name)].slice(0, 12) };
  saveProfile(next);
  return next;
}

export function exportProfile(profile: Profile): string {
  return JSON.stringify(profile);
}

export function importProfile(raw: string): Profile {
  const next = migrateProfile(JSON.parse(raw) as Partial<Profile>);
  saveProfile(next);
  return next;
}

export function persistLive(profile: Profile, session: Session, table: TableState | null): void {
  session.liveTable = table;
  profile.lastSession = session;
  saveProfile(profile);
}

export function canShowHint(_profile: Profile, _id: string): boolean {
  return true;
}

export function recordHabit(habits: HabitRecord[], review: ReviewCard): HabitRecord[] {
  const tag = review.patternTag ?? review.headline ?? "기타 실수";
  const now = Date.now();
  const list = [...habits];
  const idx = list.findIndex((h) => h.tag === tag);
  const lossDollars = review.bigBlindDollars === undefined
    ? undefined
    : Math.round(review.totalLossBb * review.bigBlindDollars * 100) / 100;
  const example = {
    at: now,
    handNumber: review.handNumber,
    body: review.body,
    loss: review.totalLossBb,
    lossDollars,
  };
  if (idx >= 0) {
    const cur = list[idx];
    const villains = cur.villains.slice();
    if (review.villainId && !villains.includes(review.villainId)) villains.push(review.villainId);
    list[idx] = {
      ...cur,
      count: cur.count + 1,
      totalLossBb: Math.round((cur.totalLossBb + review.totalLossBb) * 10) / 10,
      totalLossDollars: lossDollars === undefined
        ? cur.totalLossDollars
        : Math.round(((cur.totalLossDollars ?? 0) + lossDollars) * 100) / 100,
      lastAt: now,
      leak: cur.leak ?? review.leak,
      villains,
      examples: [example, ...cur.examples].slice(0, 8),
    };
  } else {
    list.push({
      tag,
      leak: review.leak,
      count: 1,
      totalLossBb: review.totalLossBb,
      totalLossDollars: lossDollars,
      lastAt: now,
      villains: review.villainId ? [review.villainId] : [],
      examples: [example],
    });
  }
  return list.sort((a, b) => b.totalLossBb - a.totalLossBb).slice(0, 40);
}

export function topHabits(profile: Profile, minCount = 2): HabitRecord[] {
  return (profile.habits ?? []).filter((h) => h.count >= minCount).slice(0, 8);
}

function sanitizedDecision(decision: DecisionSnapshot): DecisionSnapshot {
  const next = structuredClone(decision);
  for (const player of next.snapshot.players) {
    if (player.id !== "hero") player.hole = null;
  }
  return next;
}

export function enqueueAnalysisJob(
  profile: Profile,
  input: {
    sessionId: string;
    handNumber: number;
    review: ReviewCard;
    decisions: readonly DecisionSnapshot[];
    tellDifficulty: number;
  },
): void {
  if (input.decisions.length === 0) return;
  const job: AnalysisJob = {
    id: input.review.id,
    sessionId: input.sessionId,
    handNumber: input.handNumber,
    review: structuredClone(input.review),
    decisions: input.decisions.map(sanitizedDecision),
    tellDifficulty: input.tellDifficulty,
    createdAt: Date.now(),
  };
  profile.learning.pendingJobs = [
    ...profile.learning.pendingJobs.filter((existing) => existing.id !== job.id),
    job,
  ].slice(-4);
}

function createSkillAggregate(skill: SkillKey): SkillAggregate {
  return {
    skill,
    opportunities: 0,
    misses: 0,
    totalLossBb: 0,
    weightedScoreSum: 0,
    weightSum: 0,
    seenDecisionIds: [],
    recentScores: [],
  };
}

function analysisIsRecordable(analysis: DecisionAnalysis): boolean {
  if (decisionNeedsMoreSamples(analysis)) return false;
  return analysis.analysisBasis !== "rules" || analysis.exploitScore !== undefined;
}

export function recordDecisionAnalyses(profile: Profile, analyses: readonly DecisionAnalysis[]): void {
  const byId = new Map(profile.learning.recentDecisions.map((analysis) => [analysis.id, analysis]));
  for (const analysis of analyses) byId.set(analysis.id, analysis);
  profile.learning.recentDecisions = [...byId.values()]
    .sort((left, right) => left.analysisUpdatedAt - right.analysisUpdatedAt)
    .slice(-300);

  for (const analysis of analyses) {
    if (!analysisIsRecordable(analysis)) continue;
    const baselineMiss = analysis.baselineLossBb >= 0.8;
    const exploitMiss = analysis.exploitScore !== undefined && analysis.exploitScore < 80;
    const missed = baselineMiss || exploitMiss;
    const lossBb = missed ? Math.max(analysis.baselineLossBb, analysis.exploitLossBb ?? 0) : 0;
    const existingPattern = profile.learning.patterns[analysis.patternId]
      ?? createPatternAggregate(analysis.patternId, analysis.skill);
    profile.learning.patterns[analysis.patternId] = updatePatternAggregate(existingPattern, {
      eventId: analysis.id,
      missed,
      lossBb,
      at: analysis.analysisUpdatedAt,
    });

    const aggregate = profile.learning.skills[analysis.skill] ?? createSkillAggregate(analysis.skill);
    if (aggregate.seenDecisionIds.includes(analysis.id)) continue;
    const weight = Math.min(4, Math.max(1, Math.sqrt(Math.max(0, analysis.context.potBb))));
    aggregate.opportunities += 1;
    aggregate.misses += missed ? 1 : 0;
    aggregate.totalLossBb = Math.round((aggregate.totalLossBb + lossBb) * 10) / 10;
    aggregate.weightedScoreSum += analysis.overallScore * weight;
    aggregate.weightSum += weight;
    aggregate.seenDecisionIds.push(analysis.id);
    aggregate.recentScores = [...aggregate.recentScores, analysis.overallScore].slice(-20);
    profile.learning.skills[analysis.skill] = aggregate;
  }
}

function replaceReview(list: ReviewCard[], review: ReviewCard): ReviewCard[] {
  const index = list.findIndex((item) => item.id === review.id);
  if (index < 0) return [...list, review];
  const next = [...list];
  next[index] = review;
  return next;
}

export function finalizeHandAnalysis(profile: Profile, session: Session | null, review: ReviewCard): void {
  profile.learning.pendingJobs = profile.learning.pendingJobs.filter((job) => job.id !== review.id);
  recordDecisionAnalyses(profile, review.analyses ?? []);

  if (session) {
    session.reviews = replaceReview(session.reviews, review);
    session.missedExploits = session.reviews
      .flatMap((item) => item.analyses ?? [])
      .filter((analysis) => analysis.exploitScore !== undefined && analysis.exploitScore < 80)
      .length;
    if (profile.lastSession?.id === session.id) profile.lastSession = session;
  } else {
    const lastSession = profile.lastSession;
    if (lastSession && lastSession.id === review.analyses?.[0]?.context.sessionId) {
      lastSession.reviews = replaceReview(lastSession.reviews, review);
    }
  }

  profile.reviewQueue = profile.reviewQueue.filter((item) => item.id !== review.id);
  if (!review.viewed && review.severity !== "green") {
    profile.reviewQueue = [review, ...profile.reviewQueue].slice(0, 80);
  }
  profile.handLog = profile.handLog.map((hand) => (
    hand.sessionId === review.analyses?.[0]?.context.sessionId && hand.handNumber === review.handNumber
      ? { ...hand, severity: review.severity, headline: review.headline, leak: review.leak, villainId: review.villainId }
      : hand
  ));
  profile.sessionHistory = profile.sessionHistory.map((summary) => {
    if (summary.id !== review.analyses?.[0]?.context.sessionId) return summary;
    const reviews = session?.id === summary.id ? session.reviews : profile.lastSession?.id === summary.id ? profile.lastSession.reviews : [];
    return { ...summary, coaching: summarizeCoachingDecisions(reviews.flatMap((item) => item.analyses ?? [])) };
  });
  saveProfile(profile);
}

export function skillScore(aggregate: SkillAggregate | null | undefined): number | undefined {
  if (!aggregate || aggregate.opportunities < 3 || aggregate.weightSum <= 0) return undefined;
  return Math.round(aggregate.weightedScoreSum / aggregate.weightSum);
}

export function rememberRoom(profile: Profile, room: RoomConfig, villainIds: string[]): Profile {
  profile.lastRoom = { room, villainIds: [...villainIds], at: Date.now() };
  saveProfile(profile);
  return profile;
}

/** Keep completed live hands resumable until their mandatory review flow is finished. */
export function canResume(session: Session | null | undefined): boolean {
  return !!session?.liveTable;
}
