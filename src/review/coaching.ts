import { RANK_GLYPH, SUIT_GLYPH } from "../engine/cards";
import { legalActions, positionFor, potTotal } from "../engine/game";
import type { ActionType, Street } from "../engine/types";
import { VILLAIN_BY_ID } from "../villains/catalog";
import { mergeDecisionScores, type AnalysisStatus, type ReviewCard } from "./analyze";
import type { CandidateEv, DecisionEv, DecisionSnapshot } from "./ev";
import {
  buildGuidance,
  confidenceFor,
  decisionDisplayGuidance,
  decisionNeedsMoreSamples,
  evChoiceNeedsMoreSamples,
  scoreFromLoss,
  scoreLabel,
  type ConfidenceLevel,
  type DecisionAnalysis,
  type DecisionChoice,
  type SkillKey,
} from "./learning";
import { primaryExploitRule, type ExploitRuleResult } from "./rules";

export interface BuildDecisionAnalysesInput {
  sessionId: string;
  handNumber: number;
  decisions: readonly DecisionSnapshot[];
  scores?: readonly DecisionEv[] | null;
  updatedAt?: number;
}

const STREET_KO: Record<Street, string> = {
  preflop: "프리플랍",
  flop: "플랍",
  turn: "턴",
  river: "리버",
};

const SKILL_PRINCIPLE: Record<SkillKey, string> = {
  preflop: "프리플랍은 포지션·유효 스택·상대의 재공격 범위를 함께 봅니다.",
  position: "같은 카드도 포지션과 액션 순서가 바뀌면 가치가 달라집니다.",
  pot_odds: "콜은 이기고 싶은 마음이 아니라 필요한 승률과 예상 EV로 결정합니다.",
  aggression: "베팅은 더 나쁜 패의 콜이나 더 좋은 패의 폴드 중 하나를 만들어야 합니다.",
  sizing: "액션 방향이 같아도 사이즈가 바뀌면 상대의 계속 범위와 EV가 달라집니다.",
  street_plan: "현재 액션은 다음 스트리트 계획과 함께 선택합니다.",
  stack_awareness: "팟과 남은 스택의 비율이 커밋 기준과 가능한 사이즈를 바꿉니다.",
  opponent_exploit: "기본 전략에서 벗어날 때는 관찰 가능한 상대 성향과 명확한 조건이 필요합니다.",
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}

function choice(candidate: CandidateEv | undefined, fallbackAction: ActionType, fallbackLabel: string): DecisionChoice {
  return candidate
    ? { action: candidate.action, label: candidate.label, evBb: round1(candidate.ev), ...(candidate.raiseTo > 0 ? { sizeBb: candidate.raiseTo } : {}) }
    : { action: fallbackAction, label: fallbackLabel, evBb: 0 };
}

function actionKo(action: ActionType): string {
  if (action === "fold") return "폴드";
  if (action === "check") return "체크";
  if (action === "call") return "콜";
  if (action === "allin") return "올인";
  return action === "bet" ? "벳" : "레이즈";
}

function cardText(cards: readonly { rank: number; suit: number }[]): string {
  return cards.map((card) => `${RANK_GLYPH[card.rank as keyof typeof RANK_GLYPH]}${SUIT_GLYPH[card.suit as keyof typeof SUIT_GLYPH]}`).join(" ");
}

function skillFor(street: Street, played: CandidateEv | undefined, best: CandidateEv | undefined, snapshot: DecisionSnapshot): SkillKey {
  if (street === "preflop") return "preflop";
  if (played && best && played.action === best.action && played.raiseTo !== best.raiseTo) return "sizing";
  if (played?.action === "call" || played?.action === "fold") return "pot_odds";
  if (played?.action === "check" && best && ["bet", "raise", "allin"].includes(best.action)) return "aggression";
  const hero = snapshot.snapshot.players.find((player) => player.id === "hero");
  const position = hero ? positionFor(snapshot.snapshot.button, hero.seat, snapshot.snapshot.players.length) : null;
  if (position && ["BTN", "CO", "SB", "BB"].includes(position)) return "position";
  return "street_plan";
}

function scoreForDecision(scores: readonly DecisionEv[] | null | undefined, decision: DecisionSnapshot, ordinal: number): DecisionEv | undefined {
  if (!scores?.length) return undefined;
  const index = decision.snapshot.actionLog.length;
  return scores.find((score, scoreOrdinal) => score.index === index && score.street === decision.snapshot.street && scoreOrdinal >= ordinal) ?? scores[ordinal];
}

function candidateFraction(candidate: CandidateEv, decision: DecisionSnapshot): number {
  if (candidate.raiseTo <= 0) return 0;
  const state = decision.snapshot;
  const hero = state.players.find((player) => player.id === "hero");
  const extra = Math.max(0, candidate.raiseTo - (hero?.contributedStreet ?? 0));
  return extra / Math.max(state.bb, potTotal(state));
}

function recommendedCandidate(rule: ExploitRuleResult, score: DecisionEv | undefined, decision: DecisionSnapshot): CandidateEv | undefined {
  const candidates = score?.candidates ?? [];
  const matches = candidates.filter((candidate) => {
    if (!rule.recommendation.actions.includes(candidate.action)) return false;
    const fraction = candidateFraction(candidate, decision);
    if (rule.recommendation.minPotFraction !== undefined && fraction < rule.recommendation.minPotFraction) return false;
    if (rule.recommendation.maxPotFraction !== undefined && fraction > rule.recommendation.maxPotFraction) return false;
    return true;
  });
  return matches.sort((left, right) => right.ev - left.ev)[0]
    ?? candidates.filter((candidate) => rule.recommendation.actions.includes(candidate.action)).sort((left, right) => right.ev - left.ev)[0];
}

function capConfidence(value: ConfidenceLevel, cap: ConfidenceLevel | undefined): ConfidenceLevel {
  if (!cap) return value;
  const order: ConfidenceLevel[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(value), order.indexOf(cap))];
}

function generalPattern(skill: SkillKey, street: Street, played: DecisionChoice, best: DecisionChoice): string {
  const suffix = played.action === best.action && played.sizeBb !== best.sizeBb ? "size" : `${played.action}-to-${best.action}`;
  return `fundamentals.${skill}.${street}.${suffix}`;
}

function evidenceForEv(score: DecisionEv | undefined, played: DecisionChoice, best: DecisionChoice, lossBb: number): string[] {
  if (!score) return ["빠른 규칙 분석을 마쳤고 후보 EV 비교는 백그라운드에서 계산 중입니다."];
  const rawLoss = score.baselineRawLossBb ?? score.rawLossBb ?? lossBb;
  const uncertainty = score.baselineUncertaintyBb ?? score.uncertaintyBb ?? 0;
  if (lossBb <= 0.1 && rawLoss > 0.1 && uncertainty > Math.max(0.25, rawLoss * 0.5)) {
    return [
      `${score.samples}개 동일 표본에서 ${played.label} ${played.evBb >= 0 ? "+" : ""}${played.evBb.toFixed(1)}bb, ${best.label} ${best.evBb >= 0 ? "+" : ""}${best.evBb.toFixed(1)}bb로 원시 차이는 ${rawLoss.toFixed(1)}bb였습니다.`,
      `다만 표본 변동 ${uncertainty.toFixed(1)}bb가 커 현재 선택을 손실로 확정하지 않았습니다.`,
    ];
  }
  if (lossBb <= 0.1) return [`${score.samples}개 동일 표본에서 내 선택과 최고 후보의 원시 EV 차이가 0.1bb 이내였습니다.`];
  return [
    `${score.samples}개 동일 표본에서 ${played.label} ${played.evBb >= 0 ? "+" : ""}${played.evBb.toFixed(1)}bb, ${best.label} ${best.evBb >= 0 ? "+" : ""}${best.evBb.toFixed(1)}bb였습니다.`,
    uncertainty > 0
      ? `표본 변동 ${uncertainty.toFixed(1)}bb를 보수적으로 제외한 EV 손실 ${lossBb.toFixed(1)}bb로 평가했습니다.`
      : `결과가 아니라 선택 시점의 추정 EV 차이 ${lossBb.toFixed(1)}bb로 평가했습니다.`,
  ];
}

function opponentIdFor(decision: DecisionSnapshot, rule: ExploitRuleResult | undefined): string | undefined {
  if (rule) return rule.villainId;
  const state = decision.snapshot;
  return [...state.actionLog].reverse().find((action) => action.actorId !== "hero")?.actorId
    ?? state.players.find((player) => player.id !== "hero" && !player.folded)?.id;
}

export function buildDecisionAnalyses(input: BuildDecisionAnalysesInput): DecisionAnalysis[] {
  const updatedAt = input.updatedAt ?? Date.now();
  return input.decisions.map((decision, ordinal) => {
    const state = decision.snapshot;
    const street = state.street as Street;
    const score = scoreForDecision(input.scores, decision, ordinal);
    const rule = primaryExploitRule({ decision, score });
    const baselinePlayedCandidate = score?.baselinePlayed ?? score?.played;
    const baselineBestCandidate = score?.baselineBest ?? score?.best;
    const played = choice(baselinePlayedCandidate, decision.heroType, actionKo(decision.heroType));
    if (played.sizeBb !== undefined) played.sizeBb = round1(played.sizeBb / Math.max(1, state.bb));
    const baselineBest = choice(baselineBestCandidate, decision.heroType, actionKo(decision.heroType));
    if (baselineBest.sizeBb !== undefined) baselineBest.sizeBb = round1(baselineBest.sizeBb / Math.max(1, state.bb));
    const baselineLossBb = round1(score?.baselineLossBb ?? score?.lossBb ?? 0);
    const fundamentalsScore = round1(scoreFromLoss(baselineLossBb));
    const exploitCandidate = rule?.countsAsOpportunity ? recommendedCandidate(rule, score, decision) ?? score?.best : undefined;
    const exploitBest = exploitCandidate ? choice(exploitCandidate, exploitCandidate.action, exploitCandidate.label) : undefined;
    if (exploitBest?.sizeBb !== undefined) exploitBest.sizeBb = round1(exploitBest.sizeBb / Math.max(1, state.bb));
    const simulatedRuleLoss = exploitCandidate && score
      ? Math.max(0, exploitCandidate.ev - score.played.ev)
      : finite(score?.lossBb);
    const rulePenalty = rule?.grade === "miss" ? Math.min(3, Math.max(0.5, rule.expectedEdgeBb100 / 10)) : 0;
    const exploitLossBb = rule?.countsAsOpportunity
      ? round1(rule.grade === "success" ? 0 : Math.max(simulatedRuleLoss, rulePenalty))
      : undefined;
    const exploitScore = exploitLossBb === undefined ? undefined : round1(scoreFromLoss(exploitLossBb));
    const overallScore = round1(exploitScore === undefined ? fundamentalsScore : fundamentalsScore * 0.7 + exploitScore * 0.3);
    const skill = rule?.skill ?? skillFor(street, baselinePlayedCandidate, baselineBestCandidate, decision);
    const ruleAgreement = !!rule && !!score && !!exploitCandidate && score.best.action === exploitCandidate.action;
    const rawConfidence = confidenceFor({
      samples: score?.samples ?? 0,
      gapBb: Math.max(baselineLossBb, exploitLossBb ?? 0),
      ruleAgreement,
    });
    const baselineUncertaintyBb = score?.baselineUncertaintyBb;
    const noiseCap: ConfidenceLevel | undefined = baselineUncertaintyBb !== undefined
      && baselineUncertaintyBb > Math.max(0.25, (score?.baselineRawLossBb ?? baselineLossBb) * 0.5)
      ? "low"
      : undefined;
    const confidence = capConfidence(capConfidence(rawConfidence, rule?.confidenceCap), noiseCap);
    const uncertainChoice = evChoiceNeedsMoreSamples({
      confidence,
      adjustedLossBb: baselineLossBb,
      rawLossBb: score?.baselineRawLossBb,
      uncertaintyBb: baselineUncertaintyBb,
      choicesDiffer: played.action !== baselineBest.action || played.label !== baselineBest.label,
      hasExploitRule: !!rule,
    });
    const patternId = rule?.countsAsOpportunity ? rule.ruleId : generalPattern(skill, street, played, baselineBest);
    const judgment = rule?.judgment
      ?? (uncertainChoice
        ? `${STREET_KO[street]} 선택: ${played.label} · 아직 우열을 확정하기 어렵습니다.`
        : baselineLossBb <= 0.1
        ? `${STREET_KO[street]} 선택: ${played.label} · 최선에 가까웠습니다.`
        : `${STREET_KO[street]} 선택: ${baselineBest.label} 쪽이 더 나았습니다.`);
    const evidence = rule
      ? [...rule.evidence, ...evidenceForEv(score, played, baselineBest, baselineLossBb)]
      : evidenceForEv(score, played, baselineBest, baselineLossBb);
    const guidance = buildGuidance({
      judgment,
      evidence,
      principle: rule?.principle ?? SKILL_PRINCIPLE[skill],
      condition: rule?.condition ?? `비슷한 ${STREET_KO[street]} 상황이 다시 오면`,
      action: rule?.action ?? (uncertainChoice
        ? `${baselineBest.label} 선택을 우선 후보로 두고 같은 상황의 표본을 더 모으세요.`
        : `먼저 ${baselineBest.label} 선택을 검토하세요.`),
      exception: rule?.exception ?? (uncertainChoice
        ? "표본 변동이 큰 구간이라 현재 선택을 실수로 확정하지 않습니다."
        : confidence === "low" ? "EV 차이가 작거나 표본이 적으면 혼합 전략으로 봅니다." : undefined),
      targetOpportunities: 10,
      targetMaxMisses: 2,
    });
    const hero = state.players.find((player) => player.id === "hero");
    const opponentId = opponentIdFor(decision, rule);
    const opponent = opponentId ? state.players.find((player) => player.id === opponentId) : undefined;
    const legal = hero ? legalActions(state, hero.seat) : null;
    const effectiveStack = hero && opponent ? Math.min(hero.stack + hero.contributedHand, opponent.stack + opponent.contributedHand) : hero?.stack ?? 0;
    const actionSequence = state.actionLog.slice(-8).map((action) => `${action.actorId === "hero" ? "나" : VILLAIN_BY_ID[action.actorId]?.name ?? action.actorId} ${actionKo(action.type)}`);
    return {
      id: `${input.sessionId}:${input.handNumber}:${state.actionLog.length}:${patternId}`,
      samples: score?.samples ?? 0,
      analysisBasis: score ? (rule ? "hybrid" : "ev") : "rules",
      analysisUpdatedAt: updatedAt,
      ...(rule?.countsAsOpportunity ? { exploitRuleId: rule.ruleId } : {}),
      context: {
        sessionId: input.sessionId,
        handNumber: input.handNumber,
        decisionIndex: state.actionLog.length,
        street,
        ...(hero ? { position: positionFor(state.button, hero.seat, state.players.length) } : {}),
        potBb: round1(potTotal(state) / Math.max(1, state.bb)),
        effectiveStackBb: round1(effectiveStack / Math.max(1, state.bb)),
        toCallBb: round1((legal?.callAmount ?? 0) / Math.max(1, state.bb)),
        ...(opponentId ? { opponentId } : {}),
        board: cardText(state.board),
        ...(hero?.hole ? { holeCards: cardText(hero.hole) } : {}),
        actionSequence,
      },
      played,
      baselineBest,
      ...(exploitBest ? { exploitBest } : {}),
      baselineLossBb,
      ...(score?.baselineRawLossBb === undefined ? {} : { baselineRawLossBb: score.baselineRawLossBb }),
      ...(baselineUncertaintyBb === undefined ? {} : { baselineUncertaintyBb }),
      ...(exploitLossBb === undefined ? {} : { exploitLossBb }),
      fundamentalsScore,
      ...(exploitScore === undefined ? {} : { exploitScore }),
      overallScore,
      confidence,
      patternId,
      skill,
      guidance,
    };
  });
}

export function primaryDecisionAnalysis(analyses: readonly DecisionAnalysis[]): DecisionAnalysis | undefined {
  return [...analyses].sort((left, right) => {
    if (left.overallScore !== right.overallScore) return left.overallScore - right.overallScore;
    const leftLoss = Math.max(left.baselineLossBb, left.exploitLossBb ?? 0);
    const rightLoss = Math.max(right.baselineLossBb, right.exploitLossBb ?? 0);
    return rightLoss - leftLoss || right.context.decisionIndex - left.context.decisionIndex;
  })[0];
}

export function attachDecisionAnalyses(
  review: ReviewCard,
  analyses: DecisionAnalysis[],
  status: AnalysisStatus,
  scores?: readonly DecisionEv[] | null,
): ReviewCard {
  const scoredReview = scores?.length ? mergeDecisionScores(review, [...scores]) : review;
  const primary = primaryDecisionAnalysis(analyses);
  if (!primary) {
    return { ...scoredReview, analysisStatus: status, analyses: [], analysisUpdatedAt: Date.now() };
  }
  const overall = Math.round(primary.overallScore);
  const uncertain = decisionNeedsMoreSamples(primary);
  const displayGuidance = decisionDisplayGuidance(primary);
  const label = uncertain ? "판단 보류" : scoreLabel(overall);
  const severity = overall < 40 ? "red" : overall < 80 ? "yellow" : "green";
  const loss = round1(Math.max(primary.baselineLossBb, primary.exploitLossBb ?? 0));
  return {
    ...scoredReview,
    severity,
    totalLossBb: loss,
    street: primary.context.street,
    headline: displayGuidance.judgment,
    body: displayGuidance.evidence[0] ?? displayGuidance.principle,
    alt: `${displayGuidance.nextRule.condition} ${displayGuidance.nextRule.action}`,
    statLabel: "코칭 점수",
    statValue: `${uncertain ? "잠정 " : ""}${overall}점 · ${label}`,
    villainId: primary.context.opponentId ?? scoredReview.villainId,
    leak: primary.exploitRuleId ? VILLAIN_BY_ID[primary.context.opponentId ?? ""]?.leaks[0]?.type : scoredReview.leak,
    patternTag: primary.patternId,
    gtoLine: `기본 전략 근사 ${Math.round(primary.fundamentalsScore)}점 · ${primary.baselineBest.label}`,
    exploitLine: primary.exploitScore === undefined
      ? "이 결정에는 검증된 상대별 착취 규칙이 적용되지 않았습니다."
      : `상대 맞춤 ${Math.round(primary.exploitScore)}점 · ${primary.exploitBest?.label ?? displayGuidance.nextRule.action}`,
    analysisStatus: status,
    analyses,
    primaryDecisionId: primary.id,
    analysisUpdatedAt: Date.now(),
  };
}

export function buildReviewAnalysis(input: BuildDecisionAnalysesInput & { review: ReviewCard; status: AnalysisStatus }): ReviewCard {
  const analyses = buildDecisionAnalyses(input);
  return attachDecisionAnalyses(input.review, analyses, input.status, input.scores);
}
