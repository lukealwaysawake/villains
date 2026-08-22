import type { ActionType, Position, Street } from "../engine/types";

export type SkillKey =
  | "preflop"
  | "position"
  | "pot_odds"
  | "aggression"
  | "sizing"
  | "street_plan"
  | "stack_awareness"
  | "opponent_exploit";

export type ConfidenceLevel = "low" | "medium" | "high";

export type HabitStatus = "observing" | "signal" | "confirmed" | "improving" | "resolved";

export type ScoreLabel = "최선" | "양호" | "주의" | "실수" | "큰 실수";

export interface ConfidenceInput {
  samples: number;
  gapBb: number;
  ruleAgreement?: boolean;
  opportunities?: number;
}

export interface DecisionContext {
  sessionId: string;
  handNumber: number;
  decisionIndex: number;
  street: Street;
  position?: Position;
  potBb: number;
  effectiveStackBb: number;
  toCallBb: number;
  opponentId?: string;
  board?: string;
  holeCards?: string;
  actionSequence?: string[];
}

export interface DecisionChoice {
  action: ActionType;
  label: string;
  evBb: number;
  sizeBb?: number;
}

export interface GuidanceNextRule {
  condition: string;
  action: string;
  exception?: string;
}

export interface GuidanceTarget {
  opportunities: number;
  maxMisses: number;
}

export interface CoachingGuidance {
  judgment: string;
  evidence: string[];
  principle: string;
  nextRule: GuidanceNextRule;
  measurementTarget: GuidanceTarget;
}

export interface GuidanceInput {
  judgment?: string;
  evidence?: string | readonly string[];
  principle?: string;
  condition?: string;
  action?: string;
  exception?: string;
  targetOpportunities?: number;
  targetMaxMisses?: number;
}

export interface DecisionAnalysis {
  id: string;
  samples: number;
  analysisBasis: "rules" | "ev" | "hybrid";
  analysisUpdatedAt: number;
  exploitRuleId?: string;
  context: DecisionContext;
  played: DecisionChoice;
  baselineBest: DecisionChoice;
  exploitBest?: DecisionChoice;
  baselineLossBb: number;
  exploitLossBb?: number;
  fundamentalsScore: number;
  exploitScore?: number;
  overallScore: number;
  confidence: ConfidenceLevel;
  patternId: string;
  skill: SkillKey;
  guidance: CoachingGuidance;
}

export interface PatternOutcome {
  eventId: string;
  missed: boolean;
  lossBb: number;
  at?: number;
}

export type PatternEvent = PatternOutcome;

export interface PatternAggregate {
  patternId: string;
  skill: SkillKey;
  opportunities: number;
  misses: number;
  totalLossBb: number;
  seenEventIds: string[];
  recentOutcomes: PatternOutcome[];
  everConfirmed: boolean;
}

export interface SessionCoachingSummary {
  hasData: boolean;
  decisionCount: number;
  exploitOpportunityCount: number;
  fundamentalsScore: number;
  exploitScore?: number;
  overallScore: number;
  fundamentalsLabel?: ScoreLabel;
  exploitLabel?: ScoreLabel;
  overallLabel?: ScoreLabel;
  totalBaselineLossBb: number;
  totalExploitLossBb: number;
  confidenceCounts: Record<ConfidenceLevel, number>;
}

const LOSS_SCORE_ANCHORS = [
  { lossBb: 0.1, score: 100 },
  { lossBb: 0.5, score: 90 },
  { lossBb: 1, score: 75 },
  { lossBb: 3, score: 50 },
  { lossBb: 6, score: 20 },
  { lossBb: 10, score: 0 },
] as const;

const RECENT_OUTCOME_LIMIT = 20;

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function cleanText(value: string | undefined, fallback: string): string {
  const cleaned = value?.trim();
  return cleaned ? cleaned : fallback;
}

function isCoreConfirmed(aggregate: Pick<PatternAggregate, "opportunities" | "misses" | "totalLossBb">): boolean {
  const opportunities = finiteInteger(aggregate.opportunities, 0);
  const misses = finiteInteger(aggregate.misses, 0);
  const missRate = opportunities > 0 ? misses / opportunities : 0;
  return opportunities >= 8 && misses >= 3 && missRate >= 0.35 && finiteNonNegative(aggregate.totalLossBb) >= 2;
}

function missRate(outcomes: readonly PatternOutcome[]): number {
  if (outcomes.length === 0) return 0;
  return outcomes.filter((outcome) => outcome.missed).length / outcomes.length;
}

function weightedAverage(sum: number, weight: number): number {
  return weight > 0 ? round1(sum / weight) : 0;
}

/** Convert an EV loss in big blinds to the 0-100 coaching scale. */
export function scoreFromLoss(lossBb: number): number {
  if (!Number.isFinite(lossBb)) return 0;
  const loss = finiteNonNegative(lossBb);
  if (loss <= LOSS_SCORE_ANCHORS[0].lossBb) return LOSS_SCORE_ANCHORS[0].score;
  if (loss >= LOSS_SCORE_ANCHORS[LOSS_SCORE_ANCHORS.length - 1].lossBb) return 0;

  for (let index = 1; index < LOSS_SCORE_ANCHORS.length; index += 1) {
    const lower = LOSS_SCORE_ANCHORS[index - 1];
    const upper = LOSS_SCORE_ANCHORS[index];
    if (loss <= upper.lossBb) {
      const progress = (loss - lower.lossBb) / (upper.lossBb - lower.lossBb);
      return lower.score + (upper.score - lower.score) * progress;
    }
  }

  return 0;
}

export function scoreLabel(score: number): ScoreLabel {
  const normalized = clampScore(score);
  if (normalized >= 95) return "최선";
  if (normalized >= 80) return "양호";
  if (normalized >= 65) return "주의";
  if (normalized >= 40) return "실수";
  return "큰 실수";
}

export function confidenceFor(input: ConfidenceInput): ConfidenceLevel {
  const samples = finiteInteger(input.samples, 0);
  const gapBb = finiteNonNegative(input.gapBb);
  const opportunities = finiteInteger(input.opportunities ?? 0, 0);

  if (samples < 24 || gapBb < 0.3) return "low";
  if (samples >= 32 && (input.ruleAgreement === true || opportunities >= 8)) return "high";
  return "medium";
}

export function buildGuidance(input: GuidanceInput = {}): CoachingGuidance {
  const rawEvidence = typeof input.evidence === "string" ? [input.evidence] : [...(input.evidence ?? [])];
  const evidence = rawEvidence.map((item) => item.trim()).filter(Boolean);
  const opportunities = Math.max(1, finiteInteger(input.targetOpportunities ?? 10, 10));
  const maxMisses = Math.min(opportunities, finiteInteger(input.targetMaxMisses ?? 2, 2));
  const exception = input.exception?.trim();

  return {
    judgment: cleanText(input.judgment, "분석 보류"),
    evidence: evidence.length > 0 ? evidence : ["아직 판단에 필요한 표본이 충분하지 않습니다."],
    principle: cleanText(input.principle, "같은 기회를 더 수집한 뒤 습관 여부를 판단합니다."),
    nextRule: {
      condition: cleanText(input.condition, "같은 상황이 다시 오면"),
      action: cleanText(input.action, "기본 전략 근사를 우선합니다."),
      ...(exception ? { exception } : {}),
    },
    measurementTarget: { opportunities, maxMisses },
  };
}

export function createPatternAggregate(patternId: string, skill: SkillKey): PatternAggregate {
  return {
    patternId: patternId.trim(),
    skill,
    opportunities: 0,
    misses: 0,
    totalLossBb: 0,
    seenEventIds: [],
    recentOutcomes: [],
    everConfirmed: false,
  };
}

/** Add one pattern opportunity without mutating the existing aggregate. */
export function updatePatternAggregate(aggregate: PatternAggregate, event: PatternEvent): PatternAggregate {
  const eventId = event.eventId.trim();
  if (!eventId || aggregate.seenEventIds.includes(eventId)) return aggregate;

  const missed = event.missed === true;
  const lossBb = missed ? finiteNonNegative(event.lossBb) : 0;
  const at = event.at !== undefined && Number.isFinite(event.at) ? event.at : undefined;
  const outcome: PatternOutcome = {
    eventId,
    missed,
    lossBb,
    ...(at !== undefined ? { at } : {}),
  };
  const opportunities = finiteInteger(aggregate.opportunities, 0) + 1;
  const misses = finiteInteger(aggregate.misses, 0) + (missed ? 1 : 0);
  const totalLossBb = finiteNonNegative(aggregate.totalLossBb) + lossBb;
  const next: PatternAggregate = {
    ...aggregate,
    opportunities,
    misses,
    totalLossBb,
    seenEventIds: [...aggregate.seenEventIds, eventId],
    recentOutcomes: [...aggregate.recentOutcomes, outcome].slice(-RECENT_OUTCOME_LIMIT),
    everConfirmed: aggregate.everConfirmed,
  };
  next.everConfirmed = aggregate.everConfirmed || isCoreConfirmed(next);
  return next;
}

export function habitStatus(aggregate: PatternAggregate | null | undefined): HabitStatus {
  if (!aggregate) return "observing";

  const opportunities = finiteInteger(aggregate.opportunities, 0);
  const misses = finiteInteger(aggregate.misses, 0);
  const recent = aggregate.recentOutcomes.slice(-RECENT_OUTCOME_LIMIT);
  const wasConfirmed = aggregate.everConfirmed || isCoreConfirmed(aggregate);

  if (wasConfirmed && recent.length >= 12 && missRate(recent.slice(-12)) <= 0.15) {
    return "resolved";
  }

  if (wasConfirmed && recent.length >= 20) {
    const previousRate = missRate(recent.slice(-20, -10));
    const currentRate = missRate(recent.slice(-10));
    if (previousRate - currentRate >= 0.25) return "improving";
  }

  if (wasConfirmed) return "confirmed";
  if (opportunities >= 3 && misses >= 2) return "signal";
  return "observing";
}

export function summarizeSession(decisions: readonly DecisionAnalysis[]): SessionCoachingSummary {
  const confidenceCounts: Record<ConfidenceLevel, number> = { low: 0, medium: 0, high: 0 };
  if (decisions.length === 0) {
    return {
      hasData: false,
      decisionCount: 0,
      exploitOpportunityCount: 0,
      fundamentalsScore: 0,
      overallScore: 0,
      totalBaselineLossBb: 0,
      totalExploitLossBb: 0,
      confidenceCounts,
    };
  }

  let fundamentalWeighted = 0;
  let exploitWeighted = 0;
  let overallWeighted = 0;
  let totalWeight = 0;
  let exploitWeight = 0;
  let exploitOpportunityCount = 0;
  let totalBaselineLossBb = 0;
  let totalExploitLossBb = 0;

  for (const decision of decisions) {
    const potBb = finiteNonNegative(decision.context.potBb);
    const weight = Math.min(4, Math.max(1, Math.sqrt(potBb)));
    const fundamentalsScore = clampScore(decision.fundamentalsScore);
    const hasExploitScore = decision.exploitScore !== undefined && Number.isFinite(decision.exploitScore);
    const exploitScore = hasExploitScore ? clampScore(decision.exploitScore!) : undefined;
    const overallScore = exploitScore === undefined
      ? fundamentalsScore
      : fundamentalsScore * 0.7 + exploitScore * 0.3;

    fundamentalWeighted += fundamentalsScore * weight;
    overallWeighted += overallScore * weight;
    totalWeight += weight;
    totalBaselineLossBb += finiteNonNegative(decision.baselineLossBb);
    confidenceCounts[decision.confidence] += 1;

    if (exploitScore !== undefined) {
      exploitWeighted += exploitScore * weight;
      exploitWeight += weight;
      exploitOpportunityCount += 1;
      totalExploitLossBb += finiteNonNegative(decision.exploitLossBb ?? 0);
    }
  }

  const fundamentalsScore = weightedAverage(fundamentalWeighted, totalWeight);
  const exploitScore = exploitWeight > 0 ? weightedAverage(exploitWeighted, exploitWeight) : undefined;
  const overallScore = weightedAverage(overallWeighted, totalWeight);
  return {
    hasData: true,
    decisionCount: decisions.length,
    exploitOpportunityCount,
    fundamentalsScore,
    ...(exploitScore !== undefined ? { exploitScore } : {}),
    overallScore,
    fundamentalsLabel: scoreLabel(fundamentalsScore),
    ...(exploitScore !== undefined ? { exploitLabel: scoreLabel(exploitScore) } : {}),
    overallLabel: scoreLabel(overallScore),
    totalBaselineLossBb: round1(totalBaselineLossBb),
    totalExploitLossBb: round1(totalExploitLossBb),
    confidenceCounts,
  };
}
