import { evaluate5, evaluateBest } from "./handRank";
import { parseCard } from "./cards";
import { applyAction, createFreshPlayers, legalActions, positionFor, startHand } from "./game";
import { Rng } from "./rng";
import { canContinueSession, commitHand, createSession, dealNext, defaultProfile, defaultRoom, loadProfile, recordHabit } from "../state/store";
import { displayReviewCopy, mergeDecisionScores, type ReviewCard } from "../review/analyze";
import { dollarRateStatus, formatSignedDollars, sumKnownDollars } from "../ui/money";
import { behaviorProbe } from "./sim";
import { scoreDecision } from "../review/ev";
import { onHandEnd } from "../villains/runtime";
import { createRuntime } from "../villains/types";
import { decideVillain } from "../villains/policy";
import { EXPLOIT_RULES, type RuleContext } from "../review/rules";
import type { Action, ActionType, Street } from "./types";
import type { DecisionEv, DecisionSnapshot } from "../review/ev";
import { buildDecisionAnalyses } from "../review/coaching";
import {
  buildGuidance,
  confidenceFor,
  createPatternAggregate,
  habitStatus,
  scoreFromLoss,
  scoreLabel,
  summarizeSession as summarizeCoachingSession,
  updatePatternAggregate,
  type DecisionAnalysis,
} from "../review/learning";

let assertions = 0;
function assert(cond: boolean, msg: string) {
  assertions += 1;
  if (!cond) throw new Error(msg);
}

const royal = evaluate5(["As", "Ks", "Qs", "Js", "Ts"].map(parseCard));
const wheel = evaluate5(["Ah", "2d", "3c", "4s", "5h"].map(parseCard));
assert(royal.category === 8, "royal should be SF");
assert(wheel.category === 4, "wheel should be straight");
assert(royal.value > wheel.value, "royal > wheel");

const quads = evaluateBest(["Ah", "Ad", "Ac", "As", "2h", "2d", "9c"].map(parseCard));
assert(quads.category === 7, "quads");
const categoryOrder = [
  evaluate5(["As", "Kd", "9c", "5h", "2s"].map(parseCard)),
  evaluate5(["As", "Ad", "9c", "5h", "2s"].map(parseCard)),
  evaluate5(["As", "Ad", "9c", "9h", "2s"].map(parseCard)),
  evaluate5(["As", "Ad", "Ac", "9h", "2s"].map(parseCard)),
  evaluate5(["9s", "8d", "7c", "6h", "5s"].map(parseCard)),
  evaluate5(["As", "Js", "9s", "5s", "2s"].map(parseCard)),
  evaluate5(["As", "Ad", "Ac", "9h", "9s"].map(parseCard)),
  evaluate5(["As", "Ad", "Ac", "Ah", "9s"].map(parseCard)),
  evaluate5(["9s", "8s", "7s", "6s", "5s"].map(parseCard)),
];
assert(categoryOrder.every((score, i) => i === 0 || score.value > categoryOrder[i - 1].value), "hand categories should have strict poker ordering");

assert(positionFor(0, 0, 2) === "SB" && positionFor(0, 1, 2) === "BB", "heads-up positions should show SB and BB");
assert(positionFor(2, 0, 4) === "BB", "four-handed policy should identify the big blind");
assert(positionFor(2, 3, 4) === "SB", "four-handed policy should identify the small blind");

const scoreCases: Array<[number, number]> = [
  [0, 100], [0.1, 100], [0.3, 95], [0.5, 90], [0.75, 82.5], [1, 75],
  [2, 62.5], [3, 50], [4.5, 35], [6, 20], [8, 10], [10, 0], [99, 0],
];
for (const [loss, expected] of scoreCases) {
  assert(scoreFromLoss(loss) === expected, `loss ${loss}bb should map to ${expected}`);
}
assert(scoreLabel(95) === "최선" && scoreLabel(80) === "양호", "top coaching label boundaries");
assert(scoreLabel(65) === "주의" && scoreLabel(40) === "실수" && scoreLabel(39.9) === "큰 실수", "lower coaching label boundaries");
assert(confidenceFor({ samples: 23, gapBb: 3 }) === "low", "small EV samples should stay low confidence");
assert(confidenceFor({ samples: 32, gapBb: 0.2, ruleAgreement: true }) === "low", "tiny EV gaps should stay low confidence");
assert(confidenceFor({ samples: 24, gapBb: 0.3 }) === "medium", "adequate sample and gap should be medium confidence");
assert(confidenceFor({ samples: 32, gapBb: 0.3, ruleAgreement: true }) === "high", "rule agreement should permit high confidence");

let pattern = createPatternAggregate("river.value", "opponent_exploit");
for (let i = 0; i < 3; i += 1) {
  pattern = updatePatternAggregate(pattern, { eventId: `signal-${i}`, missed: i < 2, lossBb: i < 2 ? 0.8 : 0 });
}
assert(habitStatus(pattern) === "signal", "three opportunities and two misses should become a signal");
const duplicatePattern = updatePatternAggregate(pattern, { eventId: "signal-0", missed: true, lossBb: 9 });
assert(duplicatePattern === pattern && duplicatePattern.totalLossBb === 1.6, "duplicate pattern events must be idempotent");
for (let i = 3; i < 8; i += 1) {
  pattern = updatePatternAggregate(pattern, { eventId: `confirm-${i}`, missed: i === 3, lossBb: i === 3 ? 0.5 : 0 });
}
assert(habitStatus(pattern) === "confirmed", "approved opportunity, miss-rate, and loss thresholds should confirm a habit");
for (let i = 0; i < 12; i += 1) {
  pattern = updatePatternAggregate(pattern, { eventId: `resolved-${i}`, missed: i === 0, lossBb: i === 0 ? 0.1 : 0 });
}
assert(habitStatus(pattern) === "resolved", "one miss in the last twelve should resolve a confirmed habit");

const guide = buildGuidance({ judgment: "리버 밸류 누락", evidence: "세 번 중 두 번 체크", condition: "같은 리버에서", action: "75% 팟 밸류", targetOpportunities: 10, targetMaxMisses: 2 });
assert(guide.evidence.length === 1 && guide.measurementTarget.opportunities === 10, "coaching guidance should stay structured and measurable");

function coachingDecision(id: string, potBb: number, fundamentalsScore: number, exploitScore?: number): DecisionAnalysis {
  const played = { action: "check" as const, label: "체크", evBb: 0 };
  return {
    id,
    samples: 32,
    analysisBasis: exploitScore === undefined ? "ev" : "hybrid",
    analysisUpdatedAt: 1,
    context: { sessionId: "score-session", handNumber: 1, decisionIndex: Number(id), street: "river", potBb, effectiveStackBb: 100, toCallBb: 0 },
    played,
    baselineBest: played,
    baselineLossBb: 0,
    fundamentalsScore,
    ...(exploitScore === undefined ? {} : { exploitBest: played, exploitLossBb: 0, exploitScore }),
    overallScore: exploitScore === undefined ? fundamentalsScore : fundamentalsScore * 0.7 + exploitScore * 0.3,
    confidence: "high",
    patternId: `pattern-${id}`,
    skill: "aggression",
    guidance: guide,
  };
}
const coachingSummary = summarizeCoachingSession([
  coachingDecision("1", 1, 100),
  coachingDecision("2", 16, 50, 100),
]);
assert(coachingSummary.fundamentalsScore === 60, "session score should weight a 16bb pot four times a 1bb pot");
assert(coachingSummary.exploitScore === 100 && coachingSummary.overallScore === 72, "session total should apply 70/30 only on exploit opportunities");

function ruleFixture(
  villainId: string,
  options: {
    street?: Street;
    heroType?: ActionType;
    heroRaiseTo?: number;
    hole?: [string, string];
    board?: string[];
    actions?: Action[];
    button?: number;
    thirdSeat?: boolean;
    contributions?: [number, number];
    currentBet?: number;
    runtimeTilt?: boolean;
    score?: DecisionEv;
  } = {},
): RuleContext {
  const ids = options.thirdSeat ? ["hero", villainId, "fixture-folded"] : ["hero", villainId];
  const state = startHand({ players: createFreshPlayers(ids), button: options.button ?? 0, handNumber: 1, seed: `rule-${villainId}` });
  state.street = options.street ?? "preflop";
  state.toAct = 0;
  state.board = (options.board ?? []).map(parseCard);
  state.actionLog = options.actions ?? [];
  state.currentBet = options.currentBet ?? 0;
  state.players[0].hole = (options.hole ?? ["As", "5s"]).map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>];
  state.players[0].stack = 10000;
  state.players[1].stack = 10000;
  state.players[0].contributedHand = options.contributions?.[0] ?? 500;
  state.players[1].contributedHand = options.contributions?.[1] ?? 500;
  state.players[0].contributedStreet = 0;
  state.players[1].contributedStreet = options.actions?.at(-1)?.actorId === villainId ? Math.max(0, options.actions.at(-1)?.amount ?? 0) : 0;
  if (options.thirdSeat) state.players[2].folded = true;
  const runtime = createRuntime(villainId, 1);
  if (options.runtimeTilt) {
    runtime.emotion = "TILT";
    runtime.emotionRemainingHands = 8;
  }
  const decision: DecisionSnapshot = {
    snapshot: state,
    runtimes: { [villainId]: runtime },
    heroType: options.heroType ?? "check",
    heroRaiseTo: options.heroRaiseTo ?? 0,
  };
  return { decision, score: options.score };
}

const act = (street: Street, actorId: string, type: ActionType, amount = 0, potBefore = 1000, timeMs = 900): Action => ({
  street,
  seat: actorId === "hero" ? 0 : 1,
  actorId,
  type,
  amount,
  toCall: type === "call" ? amount : 0,
  potBefore,
  timeMs,
});

const boundaryScore: DecisionEv = {
  index: 1,
  street: "river",
  heroAction: { type: "fold", amount: 0 },
  candidates: [
    { action: "call", raiseTo: 0, label: "콜", ev: 0.2 },
    { action: "fold", raiseTo: 0, label: "폴드", ev: 0 },
  ],
  best: { action: "call", raiseTo: 0, label: "콜", ev: 0.2 },
  played: { action: "fold", raiseTo: 0, label: "폴드", ev: 0 },
  lossBb: 0.2,
  samples: 32,
  baselineCandidates: [
    { action: "call", raiseTo: 0, label: "콜", ev: 0.2 },
    { action: "fold", raiseTo: 0, label: "폴드", ev: 0 },
  ],
  baselineBest: { action: "call", raiseTo: 0, label: "콜", ev: 0.2 },
  baselinePlayed: { action: "fold", raiseTo: 0, label: "폴드", ev: 0 },
  baselineLossBb: 0.2,
};

const ruleFixtures: Record<string, RuleContext> = {
  professor: ruleFixture("professor", { heroType: "check" }),
  greatwhite: ruleFixture("greatwhite", {
    street: "river", heroType: "fold", hole: ["7h", "6h"], board: ["7s", "Kd", "2c", "3h", "9d"],
    actions: [act("river", "greatwhite", "bet", 600, 1000)],
  }),
  songtag: ruleFixture("songtag", {
    heroType: "fold", currentBet: 900,
    actions: [act("preflop", "hero", "raise", 250, 150), act("preflop", "songtag", "raise", 900, 400)],
  }),
  irongate: ruleFixture("irongate", {
    street: "flop", heroType: "check", board: ["Ks", "7d", "2c"],
    actions: [act("preflop", "hero", "raise", 250, 150), act("preflop", "irongate", "call", 150, 400), act("flop", "irongate", "check")],
  }),
  ceokim: ruleFixture("ceokim", {
    street: "river", heroType: "call", hole: ["7h", "6h"], board: ["7s", "Kd", "2c", "3h", "9d"],
    actions: [act("river", "ceokim", "bet", 1200, 1000)],
  }),
  nitlee: ruleFixture("nitlee", { heroType: "call", actions: [act("preflop", "nitlee", "raise", 250, 150)] }),
  stationpark: ruleFixture("stationpark", {
    street: "river", heroType: "bet", heroRaiseTo: 300, hole: ["6h", "5h"], board: ["As", "Kd", "Qc", "Jh", "2d"],
    actions: [act("river", "stationpark", "check")],
  }),
  madamj: ruleFixture("madamj", {
    heroType: "call", hole: ["As", "Ks"], button: 1, thirdSeat: true,
    actions: [act("preflop", "madamj", "raise", 250, 150)],
  }),
  bulldozer: ruleFixture("bulldozer", {
    street: "flop", heroType: "fold", hole: ["Ah", "7h"], board: ["7s", "Kd", "2c"],
    actions: [act("flop", "bulldozer", "bet", 500, 1000)],
  }),
  foldjeong: ruleFixture("foldjeong", {
    street: "river", heroType: "bet", heroRaiseTo: 300, hole: ["6h", "5h"], board: ["As", "Kd", "Qc", "Jh", "2d"],
    actions: [act("river", "foldjeong", "check")],
  }),
  uncleho: ruleFixture("uncleho", { heroType: "call", hole: ["As", "Ks"], actions: [act("preflop", "uncleho", "call", 100, 150)] }),
  tourneymin: ruleFixture("tourneymin", {
    street: "flop", heroType: "check", hole: ["Ah", "7h"], board: ["As", "7d", "2c"],
    actions: [act("flop", "tourneymin", "check")],
  }),
  vendetta: ruleFixture("vendetta", {
    street: "flop", heroType: "check", hole: ["Ah", "Kh"], board: ["As", "7d", "2c"], runtimeTilt: true,
    actions: [act("flop", "vendetta", "check")],
  }),
  slowroll: ruleFixture("slowroll", {
    street: "river", heroType: "fold", hole: ["7h", "6h"], board: ["7s", "Kd", "2c", "3h", "9d"], score: boundaryScore,
    actions: [act("river", "slowroll", "bet", 600, 1000, 4200)],
  }),
  weekend: ruleFixture("weekend", {
    street: "turn", heroType: "check", board: ["As", "7d", "2c", "Kh"], contributions: [3000, 3000],
    actions: [act("turn", "weekend", "check", 0, 6000)],
  }),
};

assert(EXPLOIT_RULES.length === 15, "all fifteen villains need one machine-readable exploit rule");
assert(new Set(EXPLOIT_RULES.map((rule) => rule.id)).size === 15, "exploit rule ids must be stable and unique");
for (const rule of EXPLOIT_RULES) {
  const fixture = ruleFixtures[rule.villainId];
  assert(!!fixture, `${rule.villainId} should have a golden trigger fixture`);
  assert(rule.evaluate(fixture) !== null, `${rule.id} golden fixture should trigger`);
  const guarded = structuredClone(fixture) as RuleContext;
  const target = guarded.decision.snapshot.players.find((player) => player.id === rule.villainId);
  if (target) target.folded = true;
  assert(rule.evaluate(guarded) === null, `${rule.id} folded-target guard should not trigger`);
}
const stationPreview = buildDecisionAnalyses({
  sessionId: "rule-session",
  handNumber: 1,
  decisions: [ruleFixtures.stationpark.decision],
});
assert(stationPreview[0].exploitRuleId === "stationpark.river_value_no_bluff", "decision analysis should retain the matched villain rule id");
assert(stationPreview[0].analysisBasis === "rules" && stationPreview[0].confidence === "low", "preliminary rule analysis should disclose its limited basis and confidence");
assert(stationPreview[0].guidance.nextRule.action.includes("체크"), "rule analysis should produce a concrete next-action guide");
assert(formatSignedDollars(undefined) === "—", "unknown dollar conversion must not assume a one-dollar big blind");
assert(formatSignedDollars(100) === "+$100", "known dollar values should render with a dollar sign");
const mixedDollars = sumKnownDollars([
  { bbDelta: 20, bigBlindDollars: 5 },
  { bbDelta: -10 },
]);
assert(mixedDollars.value === 100 && mixedDollars.tracked === 1 && !mixedDollars.complete, "mixed-stake totals must sum only grounded dollar values");
const pricedReview: ReviewCard = {
  id: "priced-review",
  handNumber: 1,
  severity: "red",
  totalLossBb: 10,
  bigBlindDollars: 5,
  street: "river",
  headline: "가격 검증",
  body: "10bb loss at a five-dollar big blind",
  alt: "",
  statLabel: "",
  statValue: "",
  viewed: false,
};
const pricedHabit = recordHabit([], pricedReview)[0] as ReturnType<typeof recordHabit>[number] & { totalLossDollars?: number };
assert(pricedHabit.totalLossDollars === 50, "habit ledger must persist exact dollar loss at the originating stake");

let storedProfile: string | null = null;
Object.assign(globalThis, { localStorage: { getItem: () => storedProfile, setItem: (_key: string, value: string) => { storedProfile = value; } } });
storedProfile = JSON.stringify({ mastery: { uncleho: { handsPlayed: 20, sessionsPlayed: 2, bb: 40, exploitHits: 0, exploitChances: 0, leaksFound: [], hintsUsed: false } } });
const migratedProfile = loadProfile();
assert(migratedProfile.mastery.uncleho.dollarHands === 0 && migratedProfile.mastery.uncleho.dollarDelta === 0, "legacy BB mastery must not invent dollar history during migration");
const partialRate = dollarRateStatus(25, 1, 21);
assert(!partialRate.complete && partialRate.label === "확인된 $/100 · 1핸드", "partially tracked mastery must disclose its priced-hand denominator");
storedProfile = null;
const ledgerRoom = defaultRoom({ seats: 4, sb: 2.5, bb: 5, startStack: 100 });
const ledgerSession = createSession(["uncleho", "nitlee"], "ledger-test", { room: ledgerRoom });
let ledgerState = startHand({
  players: createFreshPlayers(["hero", "uncleho", "nitlee"], 10000),
  button: 0,
  handNumber: 1,
  seed: "ledger-test",
  buyIn: 10000,
  sb: 250,
  bb: 500,
});
ledgerState = applyAction(ledgerState, "allin", 10000);
ledgerState = applyAction(ledgerState, "call");
ledgerState = applyAction(ledgerState, "call");
assert(ledgerState.street === "complete", "ledger test hand should reach completion");
const ledgerProfile = defaultProfile();
commitHand(ledgerProfile, ledgerSession, ledgerState, { ...pricedReview, handNumber: 1, bigBlindDollars: 5 });
const trackedMastery = [ledgerProfile.mastery.uncleho, ledgerProfile.mastery.nitlee] as Array<typeof ledgerProfile.mastery.uncleho & { dollarDelta?: number; dollarHands?: number }>;
const masteryDollarTotal = trackedMastery.reduce((sum, mastery) => sum + (mastery.dollarDelta ?? 0), 0);
assert(trackedMastery.every((mastery) => mastery.dollarHands === 1), "mastery ledger must track hands priced at the originating stake");
assert(Math.abs(masteryDollarTotal - ledgerSession.bbDelta * 5) < 0.001, "mastery dollar PnL must equal grounded BB PnL times the source stake");

const players = createFreshPlayers(["hero", "a", "b", "c", "d", "e"]);
let state = startHand({ players, button: 0, handNumber: 1, seed: "test" });
let guard = 0;
while (state.street !== "complete" && guard++ < 80) {
  if (state.toAct === null) break;
  state = applyAction(state, "fold");
}
assert(state.street === "complete", "fold-out should complete");
assert(!!state.result, "result exists");

const emptyPlayers = createFreshPlayers(["hero", "a"]);
for (const player of emptyPlayers) player.stack = 0;
const empty = startHand({ players: emptyPlayers, button: 0, handNumber: 2, seed: "empty", autoRebuy: false });
assert(empty.street === "complete", "zero-stack table should complete without crashing");
assert(!!empty.result && empty.result.winnersByPot.length === 0, "zero-stack table should have an empty result");

const shortPlayers = createFreshPlayers(["hero", "a"]);
shortPlayers[0].stack = 100;
shortPlayers[1].stack = 100;
let short = startHand({ players: shortPlayers, button: 0, handNumber: 3, seed: "short", autoRebuy: false, sb: 50, bb: 100 });
assert(short.toAct === 0, "small blind should act when the big blind is all-in");
short = applyAction(short, "call");
assert(short.street === "complete", "blind all-ins should run out instead of freezing");
assert(short.board.length === 5 && !!short.result, "blind all-ins should reach showdown");

let foldedHero = startHand({
  players: createFreshPlayers(["hero", "a", "b", "c"]),
  button: 0,
  handNumber: 4,
  seed: "hero-fold",
});
while (foldedHero.street !== "complete" && foldedHero.toAct !== 0) {
  const acting = foldedHero.players[foldedHero.toAct!];
  foldedHero = applyAction(foldedHero, foldedHero.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(foldedHero.toAct === 0, "hero should receive a preflop action");
foldedHero = applyAction(foldedHero, "fold");
assert(foldedHero.players[0].folded, "hero fold should be recorded");
assert(foldedHero.street !== "complete" && foldedHero.toAct !== 0, "multiway hand should continue after hero folds");
let foldGuard = 0;
while (foldedHero.street !== "complete" && foldGuard++ < 80) {
  assert(foldedHero.toAct !== null && foldedHero.toAct !== 0, "folded hero must not act again");
  const acting = foldedHero.players[foldedHero.toAct!];
  foldedHero = applyAction(foldedHero, foldedHero.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(foldedHero.street === "complete" && !!foldedHero.result, "villains should finish the hand after hero folds");

let uncontested = startHand({
  players: createFreshPlayers(["hero", "a", "b"]),
  button: 0,
  handNumber: 5,
  seed: "uncontested",
});
uncontested = applyAction(uncontested, "fold");
uncontested = applyAction(uncontested, "fold");
assert(uncontested.street === "complete", "second fold should complete an uncontested pot");
assert(uncontested.result?.winnersByPot[0]?.seats[0] === 2, "big blind should win the uncontested pot");
assert(uncontested.result?.winnersByPot.reduce((sum, pot) => sum + pot.amount, 0) === 150, "uncontested winner should receive both blinds");
assert(uncontested.players[2].stack === 10050, "uncontested pot should be credited to the winner");

const sidePotPlayers = createFreshPlayers(["hero", "a", "b"]).map((player) => ({
  ...player,
  stack: player.id === "hero" ? 300 : 1000,
}));
let sidePot = startHand({ players: sidePotPlayers, button: 0, handNumber: 6, seed: "all-in-side-pot" });
sidePot = applyAction(sidePot, "allin", 300);
assert(sidePot.players[0].allIn && sidePot.toAct === 1, "hero all-in should pass action to a remaining player");
sidePot = applyAction(sidePot, "raise", 600);
assert(sidePot.toAct === 2, "remaining player raise should keep action moving");
sidePot = applyAction(sidePot, "call");
let sideGuard = 0;
while (sidePot.street !== "complete" && sideGuard++ < 40) {
  assert(sidePot.toAct !== null && sidePot.toAct !== 0, "all-in hero must not act again");
  const acting = sidePot.players[sidePot.toAct!];
  sidePot = applyAction(sidePot, sidePot.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(sidePot.street === "complete" && sidePot.board.length === 5, "all-in hand should reach a full-board result");
assert(sidePot.pots.length >= 2, "unequal all-in contributions should create a side pot");

const finiteRoom = defaultRoom({ seats: 4, autoRebuy: true, buyInLimit: 2, sb: 0.5, bb: 1, startStack: 100 });
const finite = createSession(["uncleho", "nitlee"], "selftest", { room: finiteRoom });
finite.stacks = { hero: 10000, uncleho: 0, nitlee: 0 };
finite.buyIns = { hero: 1, uncleho: 1, nitlee: 1 };
assert(canContinueSession(finite).ok, "surviving hero plus available opponent rebuys should keep the session alive");
const rebought = dealNext(finite);
assert(rebought.players.length === 3, "all eligible seats should rebuy into the next hand");
assert(finite.buyIns?.hero === 1 && finite.buyIns?.uncleho === 2 && finite.buyIns?.nitlee === 2, "finite rebuy usage should increment only for busted seats");
finite.stacks = { hero: 0, uncleho: 0, nitlee: 0 };
const exhausted = canContinueSession(finite);
assert(!exhausted.ok && exhausted.reason === "모든 플레이어가 탈락했습니다.", "all-busted table should end even when rebuys remain");

const noRebuyRoom = defaultRoom({ seats: 4, autoRebuy: false, buyInLimit: 1, sb: 0.5, bb: 1, startStack: 100 });
const remaining = createSession(["uncleho", "nitlee"], "selftest", { room: noRebuyRoom });
remaining.stacks = { hero: 10000, uncleho: 0, nitlee: 10000 };
assert(canContinueSession(remaining).ok, "hero and one funded opponent should continue");
const headsUp = dealNext(remaining);
assert(headsUp.players.map((player) => player.id).join(",") === "hero,nitlee", "eliminated opponent should sit out");
assert(positionFor(headsUp.button, headsUp.button, 2) === "SB", "heads-up button should be the small blind");
remaining.stacks = { hero: 0, uncleho: 0, nitlee: 0 };
assert(!canContinueSession(remaining).ok, "no-rebuy table should stop when everyone is eliminated");

const rng = new Rng(1);
for (let i = 0; i < 40; i++) {
  let s = startHand({
    players: createFreshPlayers(["hero", "a", "b", "c", "d", "e"]),
    button: i % 6,
    handNumber: i + 1,
    seed: `sim${i}`,
  });
  let n = 0;
  while (s.street !== "complete" && n++ < 120) {
    if (s.toAct === null) break;
    const r = rng.float();
    if (r < 0.35) s = applyAction(s, "fold");
    else if (r < 0.75) s = applyAction(s, s.currentBet === s.players[s.toAct].contributedStreet ? "check" : "call");
    else s = applyAction(s, "raise", s.currentBet + 200 + s.players[s.toAct].contributedStreet);
  }
  assert(s.street === "complete", `hand ${i} completed`);
}

const decisionState = startHand({
  players: createFreshPlayers(["hero", "stationpark"]),
  button: 0,
  handNumber: 1,
  seed: "decision-review",
});
decisionState.players[0].hole = [parseCard("As"), parseCard("Ah")];
const decision = scoreDecision(
  decisionState,
  "fold",
  0,
  { stationpark: createRuntime("stationpark", 1) },
  24,
);
assert(decision.candidates.length >= 3, "decision review should compare multiple legal choices");
assert(decision.lossBb > 0, "folding aces should produce a non-zero EV loss");
assert(decision.played.label === "폴드", "played action should use a localized label");
assert(!!decision.baselineBest && !!decision.baselinePlayed && decision.baselineCandidates?.length === decision.candidates.length, "decision review should preserve separate baseline and exploit candidate sets");

const greenReview: ReviewCard = {
  ...pricedReview,
  id: "green-review",
  severity: "green",
  totalLossBb: 0,
  street: "flop",
  headline: "괜찮은 핸드",
  body: "착취 기준에서 큰 누수는 없었습니다.",
  streets: [{
    street: "flop",
    label: "플랍",
    board: "A♠ 7♦ 2♣",
    made: "탑페어",
    actions: "벳 $1",
    potBb: 3,
    note: "주도권 잡음",
  }],
};
const playedBet = { action: "bet" as const, raiseTo: 100, label: "벳 $1", ev: 1.2 };
const bestCheck = { action: "check" as const, raiseTo: 0, label: "체크", ev: 1.5 };
const enrichedGreen = mergeDecisionScores(greenReview, [{
  index: 4,
  street: "flop",
  heroAction: { type: "bet", amount: 100 },
  candidates: [bestCheck, playedBet],
  best: bestCheck,
  played: playedBet,
  lossBb: 0.3,
  samples: 24,
}]);
assert(enrichedGreen.severity === "green", "small EV gaps should remain green");
assert(enrichedGreen.headline.includes("벳 $1") && enrichedGreen.headline.includes("0.3bb"), "green review headline should name the actual decision and gap");
assert(enrichedGreen.body.includes("체크") && !enrichedGreen.body.includes("큰 누수"), "green review body should explain the EV comparison instead of fallback copy");
assert(enrichedGreen.decision?.played.label === "벳 $1" && enrichedGreen.decision.best.label === "체크", "review should persist played and best candidates");
assert(enrichedGreen.decision?.samples === 24 && enrichedGreen.body.includes("24개"), "review should disclose the EV sample count");
const normalizedDecisionCopy = displayReviewCopy({
  ...enrichedGreen,
  body: "24개 동일 표본에서 벳 $1은 +1.2bb, 체크는 +1.5bb로 차이가 났습니다.",
});
assert(normalizedDecisionCopy.body.includes("추정 EV는") && !normalizedDecisionCopy.body.includes("벳 $1은"), "stored EV reviews should be normalized to polished decision copy");

const legacyCopy = displayReviewCopy({
  ...greenReview,
  candidates: [{ label: "체크", ev: 1.5 }, { label: "벳 $1", ev: 1.2 }],
});
assert(legacyCopy.headline.includes("플랍 벳 $1") && legacyCopy.body.includes("체크"), "legacy generic reviews should be reinterpreted from street and candidate data");

function replayPolicyHand() {
  const ids = ["hero", "uncleho", "nitlee", "stationpark"];
  let hand = startHand({
    players: createFreshPlayers(ids),
    button: 2,
    handNumber: 7,
    seed: "policy-replay",
  });
  const runtimes = Object.fromEntries(ids.slice(1).map((id, i) => [id, createRuntime(id, i + 1)]));
  let actions = 0;
  while (hand.street !== "complete" && hand.toAct !== null && actions++ < 100) {
    const actor = hand.players[hand.toAct];
    if (actor.id === "hero") {
      const legal = legalActions(hand, actor.seat);
      hand = applyAction(hand, legal.canCheck ? "check" : legal.canCall ? "call" : "fold");
    } else {
      const move = decideVillain(hand, runtimes[actor.id], 0.78, true);
      hand = applyAction(hand, move.type, move.raiseTo);
    }
  }
  assert(hand.street === "complete", "deterministic policy replay should finish");
  return JSON.stringify(hand.actionLog);
}

assert(replayPolicyHand() === replayPolicyHand(), "the same seed should reproduce the full action log");

function confidenceSequence() {
  const sequence: string[] = [];
  for (let handNumber = 1; handNumber <= 64; handNumber++) {
    const hand = startHand({
      players: createFreshPlayers(["hero", "vendetta"]),
      button: handNumber % 2,
      handNumber,
      seed: "emotion-replay",
    });
    hand.players[1].stack = 12000;
    hand.street = "complete";
    hand.toAct = null;
    hand.result = {
      winnersByPot: [],
      shown: {},
      heroDelta: 0,
      deltas: { hero: 0, vendetta: 0 },
    };
    const runtime = createRuntime("vendetta", 1);
    onHandEnd({ state: hand, runtimes: { vendetta: runtime }, heroFoldStreak: 0 });
    sequence.push(runtime.emotion);
  }
  return sequence;
}

const emotions = confidenceSequence();
assert(emotions.join(",") === confidenceSequence().join(","), "emotion changes should replay from the same seed");
assert(emotions.includes("CONFIDENT"), "determinism check should exercise the confidence branch");

assert(behaviorProbe(12, 2).length > 0, "heads-up behavior probe should run");
assert(behaviorProbe(12, 4).length > 0, "four-handed behavior probe should run");
assert(behaviorProbe(12, 6).length > 0, "six-handed behavior probe should run");

console.log(`selftest ok: ${assertions} assertions; engine flow, dollar provenance, seeded replay, EV review, and 2/4/6-seat probes`);
