import { chenPercentile } from "../engine/chen";
import { positionFor, potTotal, type TableState } from "../engine/game";
import { preflopStrength, readSpot } from "../engine/handRank";
import type { Action, ActionType, PlayerState, Street } from "../engine/types";
import type { DecisionEv, DecisionSnapshot } from "./ev";
import type { ConfidenceLevel, SkillKey } from "./learning";

export type RuleGrade = "success" | "miss" | "neutral";

export interface RuleRecommendation {
  actions: ActionType[];
  minPotFraction?: number;
  maxPotFraction?: number;
}

export interface ExploitRuleResult {
  ruleId: string;
  villainId: string;
  skill: SkillKey;
  grade: RuleGrade;
  expectedEdgeBb100: number;
  headline: string;
  judgment: string;
  evidence: string[];
  principle: string;
  condition: string;
  action: string;
  exception?: string;
  recommendation: RuleRecommendation;
  confidenceCap?: ConfidenceLevel;
  countsAsOpportunity: boolean;
}

export interface RuleContext {
  decision: DecisionSnapshot;
  score?: DecisionEv;
}

interface RuleAssessment {
  grade: RuleGrade;
  judgment: string;
  evidence?: string[];
  recommendation: RuleRecommendation;
  countsAsOpportunity?: boolean;
}

export interface ExploitRuleDefinition {
  id: string;
  villainId: string;
  skill: SkillKey;
  expectedEdgeBb100: number;
  headline: string;
  evidence: string;
  principle: string;
  condition: string;
  action: string;
  exception?: string;
  confidenceCap?: ConfidenceLevel;
  evaluate: (context: RuleContext) => RuleAssessment | null;
}

const AGGRESSIVE: ActionType[] = ["bet", "raise", "allin"];

function stateOf(context: RuleContext): TableState {
  return context.decision.snapshot;
}

function streetOf(context: RuleContext): Street | null {
  const street = stateOf(context).street;
  return street === "showdown" || street === "complete" ? null : street;
}

function heroOf(context: RuleContext): PlayerState | null {
  return stateOf(context).players.find((player) => player.id === "hero") ?? null;
}

function villainOf(context: RuleContext, villainId: string): PlayerState | null {
  return stateOf(context).players.find((player) => player.id === villainId) ?? null;
}

function heroActs(context: RuleContext, actions: readonly ActionType[]): boolean {
  return actions.includes(context.decision.heroType);
}

function headsUpWith(context: RuleContext, villainId: string): boolean {
  const live = stateOf(context).players.filter((player) => !player.folded);
  return live.length === 2 && live.some((player) => player.id === "hero") && live.some((player) => player.id === villainId);
}

function lastAction(context: RuleContext, actorId: string, street?: Street): Action | undefined {
  return [...stateOf(context).actionLog]
    .reverse()
    .find((item) => item.actorId === actorId && (street === undefined || item.street === street));
}

function currentStreetActions(context: RuleContext): Action[] {
  const street = streetOf(context);
  return street ? stateOf(context).actionLog.filter((item) => item.street === street) : [];
}

function lastStreetAction(context: RuleContext): Action | undefined {
  return currentStreetActions(context).at(-1);
}

function heroPosition(context: RuleContext) {
  const state = stateOf(context);
  const hero = heroOf(context);
  return hero ? positionFor(state.button, hero.seat, state.players.length) : null;
}

function villainPosition(context: RuleContext, villainId: string) {
  const state = stateOf(context);
  const villain = villainOf(context, villainId);
  return villain ? positionFor(state.button, villain.seat, state.players.length) : null;
}

function effectiveStackBb(context: RuleContext, villainId: string): number {
  const state = stateOf(context);
  const hero = heroOf(context);
  const villain = villainOf(context, villainId);
  if (!hero || !villain) return 0;
  return Math.min(hero.stack + hero.contributedHand, villain.stack + villain.contributedHand) / Math.max(1, state.bb);
}

function heroPotFraction(context: RuleContext): number {
  const state = stateOf(context);
  const hero = heroOf(context);
  if (!hero || context.decision.heroRaiseTo <= 0) return 0;
  const extra = Math.max(0, context.decision.heroRaiseTo - hero.contributedStreet);
  return extra / Math.max(state.bb, potTotal(state));
}

function facedFraction(context: RuleContext, villainId: string): number {
  const action = lastAction(context, villainId, streetOf(context) ?? undefined);
  if (!action || !AGGRESSIVE.includes(action.type)) return 0;
  const villain = villainOf(context, villainId);
  const paidOrTarget = action.type === "raise" || action.type === "allin"
    ? Math.max(action.amount, villain?.contributedStreet ?? 0)
    : action.amount;
  return paidOrTarget / Math.max(stateOf(context).bb, action.potBefore);
}

function heroRead(context: RuleContext) {
  const state = stateOf(context);
  const hero = heroOf(context);
  if (!hero?.hole || state.board.length < 3) return null;
  return readSpot(hero.hole, state.board);
}

function heroPercentile(context: RuleContext): number {
  const hero = heroOf(context);
  return hero?.hole ? chenPercentile(preflopStrength(hero.hole)) : 100;
}

function hasWheelAceBlocker(context: RuleContext): boolean {
  const hole = heroOf(context)?.hole;
  if (!hole) return false;
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  return high.rank === 14 && low.rank >= 2 && low.rank <= 5 && high.suit === low.suit;
}

function hasPreflopBlocker(context: RuleContext): boolean {
  const hole = heroOf(context)?.hole;
  if (!hole) return false;
  const ranks = hole.map((card) => card.rank).sort((a, b) => b - a);
  const suitedKq = ranks[0] === 13 && ranks[1] === 12 && hole[0].suit === hole[1].suit;
  return hasWheelAceBlocker(context) || suitedKq;
}

function preflopActions(context: RuleContext): Action[] {
  return stateOf(context).actionLog.filter((action) => action.street === "preflop");
}

function actorAggressedPreflop(context: RuleContext, actorId: string): boolean {
  return preflopActions(context).some((action) => action.actorId === actorId && AGGRESSIVE.includes(action.type));
}

function actorCalledPreflop(context: RuleContext, actorId: string): boolean {
  return preflopActions(context).some((action) => action.actorId === actorId && action.type === "call");
}

function lastWasCheckBy(context: RuleContext, villainId: string): boolean {
  const action = lastStreetAction(context);
  return action?.actorId === villainId && action.type === "check";
}

function facedAggressionBy(context: RuleContext, villainId: string): boolean {
  const action = lastStreetAction(context);
  return !!action && action.actorId === villainId && AGGRESSIVE.includes(action.type);
}

function baselineCandidateGap(context: RuleContext): number | null {
  const candidates = context.score?.baselineCandidates ?? context.score?.candidates;
  if (!candidates || candidates.length < 2) return null;
  return Math.max(0, candidates[0].ev - candidates[1].ev);
}

function result(
  rule: Omit<ExploitRuleDefinition, "evaluate">,
  assessment: RuleAssessment,
): ExploitRuleResult {
  return {
    ruleId: rule.id,
    villainId: rule.villainId,
    skill: rule.skill,
    grade: assessment.grade,
    expectedEdgeBb100: rule.expectedEdgeBb100,
    headline: rule.headline,
    judgment: assessment.judgment,
    evidence: assessment.evidence ?? [rule.evidence],
    principle: rule.principle,
    condition: rule.condition,
    action: rule.action,
    ...(rule.exception ? { exception: rule.exception } : {}),
    recommendation: assessment.recommendation,
    ...(rule.confidenceCap ? { confidenceCap: rule.confidenceCap } : {}),
    countsAsOpportunity: assessment.countsAsOpportunity ?? assessment.grade !== "neutral",
  };
}

export const EXPLOIT_RULES: readonly ExploitRuleDefinition[] = [
  {
    id: "professor.no_forced_exploit",
    villainId: "professor",
    skill: "opponent_exploit",
    expectedEdgeBb100: 0,
    headline: "억지 착취 없이 기준 전략을 지킬 자리",
    evidence: "교수의 기본 성향에는 반복해서 노릴 큰 누수가 없습니다.",
    principle: "균형 잡힌 상대에게 없는 구멍을 만들면 내가 먼저 무너집니다.",
    condition: "교수에게 명확한 규칙 우위가 보이지 않으면",
    action: "기본 전략 근사의 최선 후보를 유지하세요.",
    exception: "40bb 이하의 미세 오차도 한 핸드만으로 착취 습관이라 단정하지 않습니다.",
    evaluate: (context) => headsUpWith(context, "professor")
      ? { grade: "neutral", judgment: "억지 착취보다 기본 결정의 품질을 봅니다.", recommendation: { actions: context.score ? [context.score.baselineBest?.action ?? context.score.best.action] : [] }, countsAsOpportunity: false }
      : null,
  },
  {
    id: "greatwhite.river_bluffcatch_one_step",
    villainId: "greatwhite",
    skill: "opponent_exploit",
    expectedEdgeBb100: 3,
    headline: "백상어의 리버 블러프에 한 단계 더 버틸 자리",
    evidence: "백상어의 기본 성향은 리버 블러프가 최적보다 조금 많습니다.",
    principle: "미세한 블러프 과다는 콜 범위를 한 단계만 넓혀야 잡힙니다.",
    condition: "리버 블러프캐처로 75% 팟 이하 벳을 맞으면",
    action: "기본 기준보다 한 단계 넓게 콜하세요.",
    exception: "오버벳·리버 레이즈·멀티웨이에서는 기본 기준으로 돌아갑니다.",
    evaluate: (context) => {
      const read = heroRead(context);
      if (!headsUpWith(context, "greatwhite") || streetOf(context) !== "river" || !facedAggressionBy(context, "greatwhite") || facedFraction(context, "greatwhite") > 0.75 || !read) return null;
      if (!["weakpair", "midpair", "toppair"].includes(read.made)) return null;
      if (heroActs(context, ["call"])) return { grade: "success", judgment: "한 단계 넓힌 블러프캐치가 맞았습니다.", recommendation: { actions: ["call"] } };
      if (heroActs(context, ["fold"])) return { grade: "miss", judgment: "콜할 수 있는 블러프캐처를 너무 일찍 접었습니다.", recommendation: { actions: ["call"] } };
      return { grade: "neutral", judgment: "한 단계보다 크게 이탈한 선택은 규칙만으로 채점하지 않습니다.", recommendation: { actions: ["call"] }, countsAsOpportunity: false };
    },
  },
  {
    id: "songtag.light_fourbet",
    villainId: "songtag",
    skill: "preflop",
    expectedEdgeBb100: 8,
    headline: "송실장의 정직한 3벳에 4벳할 자리",
    evidence: "송실장의 기본 fold to 4-bet은 78%입니다.",
    principle: "정직한 3벳 레인지는 블로커 4벳으로 선별 압박합니다.",
    condition: "내 오픈 뒤 송실장이 첫 3벳하고 블로커가 있으면",
    action: "3벳의 2.2~2.5배로 작게 4벳하세요.",
    exception: "멀티웨이·60bb 미만·블로커 없는 하위 핸드는 제외합니다.",
    evaluate: (context) => {
      if (!headsUpWith(context, "songtag") || streetOf(context) !== "preflop" || !hasPreflopBlocker(context) || effectiveStackBb(context, "songtag") < 60) return null;
      const actions = preflopActions(context);
      const heroOpen = actions.findIndex((action) => action.actorId === "hero" && AGGRESSIVE.includes(action.type));
      const songThree = actions.findIndex((action, index) => index > heroOpen && action.actorId === "songtag" && AGGRESSIVE.includes(action.type));
      if (heroOpen < 0 || songThree < 0 || actions.slice(songThree + 1).some((action) => action.actorId !== "hero" && action.actorId !== "songtag" && !["fold"].includes(action.type))) return null;
      const ratio = context.decision.heroRaiseTo / Math.max(stateOf(context).bb, stateOf(context).currentBet);
      const goodRaise = heroActs(context, ["raise", "allin"]) && ratio >= 2.1 && ratio <= 2.7;
      return goodRaise
        ? { grade: "success", judgment: "블로커 4벳으로 과폴드를 정확히 압박했습니다.", recommendation: { actions: ["raise"], minPotFraction: 2.1, maxPotFraction: 2.7 } }
        : { grade: "miss", judgment: "블로커 4벳 기회를 수동적으로 넘겼습니다.", recommendation: { actions: ["raise"] } };
    },
  },
  {
    id: "irongate.blind_caller_flop_cbet",
    villainId: "irongate",
    skill: "position",
    expectedEdgeBb100: 11,
    headline: "철벽의 블라인드 과폴드를 압박할 자리",
    evidence: "철벽의 기본 블라인드 콜 후 플랍 폴드는 68%입니다.",
    principle: "같은 상대도 포지션에 따라 폴드 빈도가 달라집니다.",
    condition: "철벽이 블라인드에서 내 오픈을 콜하고 플랍을 체크하면",
    action: "33~50% 팟으로 작게 c-bet하세요.",
    exception: "멀티웨이거나 철벽이 프리플랍 공격자면 제외합니다.",
    evaluate: (context) => {
      const position = villainPosition(context, "irongate");
      if (!headsUpWith(context, "irongate") || streetOf(context) !== "flop" || !["SB", "BB"].includes(position ?? "") || !lastWasCheckBy(context, "irongate")) return null;
      if (!actorAggressedPreflop(context, "hero") || !actorCalledPreflop(context, "irongate") || actorAggressedPreflop(context, "irongate")) return null;
      const fraction = heroPotFraction(context);
      const good = heroActs(context, AGGRESSIVE) && fraction >= 0.28 && fraction <= 0.55;
      return good
        ? { grade: "success", judgment: "작은 c-bet으로 위치별 과폴드를 잘 공략했습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.33, maxPotFraction: 0.5 } }
        : { grade: "miss", judgment: "높은 폴드 빈도를 압박할 c-bet을 놓쳤습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.33, maxPotFraction: 0.5 } };
    },
  },
  {
    id: "ceokim.river_overbet_fold",
    villainId: "ceokim",
    skill: "sizing",
    expectedEdgeBb100: 9,
    headline: "김대표의 리버 오버벳은 강한 쪽으로 기웁니다",
    evidence: "김대표의 기본 리버 오버벳 블러프 비율은 14%입니다.",
    principle: "이 상대의 오버벳 사이즈는 레인지보다 더 많은 정보를 줍니다.",
    condition: "김대표가 리버에 115% 팟 이상 오버벳하면",
    action: "스트레이트 미만의 마진 핸드는 폴드하세요.",
    exception: "강한 스트레이트 이상이거나 적응 상태가 확인되면 EV 비교를 우선합니다.",
    evaluate: (context) => {
      const read = heroRead(context);
      if (!headsUpWith(context, "ceokim") || streetOf(context) !== "river" || !facedAggressionBy(context, "ceokim") || facedFraction(context, "ceokim") < 1.15 || !read || ["straight", "flush", "fullhouse", "nuts"].includes(read.made)) return null;
      return heroActs(context, ["fold"])
        ? { grade: "success", judgment: "오버벳의 강한 정보에 맞춰 마진 핸드를 잘 접었습니다.", recommendation: { actions: ["fold"] } }
        : { grade: "miss", judgment: "블러프 비율이 낮은 오버벳에 마진 핸드로 계속했습니다.", recommendation: { actions: ["fold"] } };
    },
  },
  {
    id: "nitlee.open_threebet",
    villainId: "nitlee",
    skill: "preflop",
    expectedEdgeBb100: 16,
    headline: "이대리의 오픈을 3벳으로 가져올 자리",
    evidence: "이대리의 기본 fold to 3-bet은 82%입니다.",
    principle: "오픈은 강하지만 재압박에 과하게 접는 상대는 블로커로 선별 공격합니다.",
    condition: "이대리가 첫 오픈하고 내가 블로커 핸드를 가지면",
    action: "인포지션은 약 3배, 블라인드는 약 4배로 3벳하세요.",
    exception: "UTG 충돌·멀티웨이·40bb 미만·블로커 없는 핸드는 제외합니다.",
    evaluate: (context) => {
      if (!headsUpWith(context, "nitlee") || streetOf(context) !== "preflop" || !hasPreflopBlocker(context) || effectiveStackBb(context, "nitlee") < 40 || heroPosition(context) === "UTG") return null;
      const actions = preflopActions(context);
      const open = actions.find((action) => action.actorId === "nitlee" && AGGRESSIVE.includes(action.type));
      if (!open || actions.some((action) => action !== open && action.actorId !== "hero" && action.actorId !== "nitlee" && action.type !== "fold")) return null;
      return heroActs(context, ["raise", "allin"])
        ? { grade: "success", judgment: "높은 3벳 폴드를 블로커로 잘 압박했습니다.", recommendation: { actions: ["raise"] } }
        : { grade: "miss", judgment: "수익성 있는 선별 3벳 기회를 넘겼습니다.", recommendation: { actions: ["raise"] } };
    },
  },
  {
    id: "stationpark.river_value_no_bluff",
    villainId: "stationpark",
    skill: "opponent_exploit",
    expectedEdgeBb100: 22,
    headline: "박사장에게는 블러프보다 밸류가 먼저입니다",
    evidence: "박사장의 기본 river fold 12%, WTSD 41%는 매우 넓은 콜 성향입니다.",
    principle: "안 접는 상대에게 블러프는 사라지고 얇은 밸류가 넓어집니다.",
    condition: "박사장이 리버를 체크해 내게 액션이 오면",
    action: "쇼다운 가치가 있으면 크게 밸류하고, 에어면 체크하세요.",
    exception: "중간 강도와 멀티웨이는 규칙만으로 채점하지 않습니다.",
    evaluate: (context) => {
      const read = heroRead(context);
      if (!headsUpWith(context, "stationpark") || streetOf(context) !== "river" || !lastWasCheckBy(context, "stationpark") || !read) return null;
      if (read.strength >= 0.4) {
        const fraction = heroPotFraction(context);
        const good = heroActs(context, AGGRESSIVE) && fraction >= 0.65;
        return good
          ? { grade: "success", judgment: "넓은 콜 범위에서 충분한 밸류를 받았습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } }
          : { grade: "miss", judgment: "박사장의 넓은 콜 범위에서 받을 밸류를 놓쳤습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
      }
      if (read.strength <= 0.2) {
        return heroActs(context, ["check"])
          ? { grade: "success", judgment: "폴드하지 않는 상대에게 불필요한 블러프를 아꼈습니다.", recommendation: { actions: ["check"] } }
          : { grade: "miss", judgment: "리버 폴드 12% 상대에게 에어로 블러프했습니다.", recommendation: { actions: ["check"] } };
      }
      return null;
    },
  },
  {
    id: "madamj.button_steal_threebet",
    villainId: "madamj",
    skill: "position",
    expectedEdgeBb100: 13,
    headline: "여사장의 버튼 스틸에 재압박할 자리",
    evidence: "여사장의 기본 BTN 오픈 52%, fold to 3-bet 65%입니다.",
    principle: "버튼의 넓은 오픈은 블라인드의 선별 3벳 기회를 만듭니다.",
    condition: "여사장이 버튼에서 첫 오픈하고 내가 블라인드면",
    action: "상위 35% 또는 블로커 핸드로 약 4배 3벳하세요.",
    exception: "버튼이 아닌 위치·멀티웨이·50bb 미만에서는 같은 조정을 쓰지 않습니다.",
    evaluate: (context) => {
      if (!headsUpWith(context, "madamj") || streetOf(context) !== "preflop" || villainPosition(context, "madamj") !== "BTN" || !["SB", "BB"].includes(heroPosition(context) ?? "") || effectiveStackBb(context, "madamj") < 50 || heroPercentile(context) > 35) return null;
      if (!actorAggressedPreflop(context, "madamj")) return null;
      return heroActs(context, ["raise", "allin"])
        ? { grade: "success", judgment: "버튼의 넓은 스틸 범위를 블라인드에서 재압박했습니다.", recommendation: { actions: ["raise"] } }
        : { grade: "miss", judgment: "버튼 스틸에 선별 3벳할 기회를 수동적으로 넘겼습니다.", recommendation: { actions: ["raise"] } };
    },
  },
  {
    id: "bulldozer.float_flop_take_turn",
    villainId: "bulldozer",
    skill: "street_plan",
    expectedEdgeBb100: 19,
    headline: "플랍을 버티고 턴을 가져올 계획이 필요합니다",
    evidence: "불도저의 기본 flop c-bet 82%와 turn barrel 38% 사이에 큰 단절이 있습니다.",
    principle: "플랍과 턴의 공격성 단절은 한 스트리트 뒤에서 수익이 납니다.",
    condition: "불도저의 작은 플랍 c-bet에 계속할 근거가 있으면",
    action: "플랍을 콜하고, 턴 체크에는 60~75% 팟으로 가져오세요.",
    exception: "무에쿼티 에어·오버벳·체크레이즈·멀티웨이는 제외합니다.",
    evaluate: (context) => {
      if (!headsUpWith(context, "bulldozer")) return null;
      const read = heroRead(context);
      if (streetOf(context) === "flop" && facedAggressionBy(context, "bulldozer") && facedFraction(context, "bulldozer") <= 0.75 && read) {
        const canContinue = read.made !== "air" || read.flushDraw || read.oesd || read.gutshot || read.overcards > 0;
        if (!canContinue) return null;
        if (heroActs(context, ["call"])) return { grade: "success", judgment: "플랍 과다 c-bet을 한 번 버틸 근거가 있었습니다.", recommendation: { actions: ["call"] } };
        if (heroActs(context, ["fold"])) return { grade: "miss", judgment: "계속할 근거가 있는 핸드를 플랍에서 너무 빨리 접었습니다.", recommendation: { actions: ["call"] } };
        return null;
      }
      if (streetOf(context) === "turn" && lastWasCheckBy(context, "bulldozer")) {
        const flopActions = stateOf(context).actionLog.filter((action) => action.street === "flop");
        const floated = flopActions.some((action) => action.actorId === "bulldozer" && AGGRESSIVE.includes(action.type)) && flopActions.some((action) => action.actorId === "hero" && action.type === "call");
        if (!floated) return null;
        const fraction = heroPotFraction(context);
        const good = heroActs(context, AGGRESSIVE) && fraction >= 0.55 && fraction <= 0.85;
        return good
          ? { grade: "success", judgment: "불도저가 멈춘 턴을 계획대로 가져왔습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.6, maxPotFraction: 0.75 } }
          : { grade: "miss", judgment: "플랍을 버틴 뒤 불도저가 멈춘 턴의 공격 기회를 놓쳤습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.6, maxPotFraction: 0.75 } };
      }
      return null;
    },
  },
  {
    id: "foldjeong.river_size_polarity",
    villainId: "foldjeong",
    skill: "sizing",
    expectedEdgeBb100: 14,
    headline: "정과장에게는 핸드 목적에 따라 사이즈가 뒤집힙니다",
    evidence: "정과장의 기본 river fold는 큰 벳 71%, 작은 벳 18%입니다.",
    principle: "상대의 사이즈 반응이 극단적이면 블러프와 얇은 밸류의 크기를 분리합니다.",
    condition: "정과장이 리버를 체크하고 내 핸드 목적이 분명하면",
    action: "블러프는 75% 이상, 얇은 밸류는 40% 이하로 베팅하세요.",
    exception: "중간 강도·멀티웨이·명백한 음수 EV 블러프는 제외합니다.",
    evaluate: (context) => {
      const read = heroRead(context);
      if (!headsUpWith(context, "foldjeong") || streetOf(context) !== "river" || !lastWasCheckBy(context, "foldjeong") || !read) return null;
      const fraction = heroPotFraction(context);
      if (read.strength <= 0.2) {
        if (heroActs(context, AGGRESSIVE) && fraction >= 0.7) return { grade: "success", judgment: "블러프 목적에 맞는 큰 사이즈를 골랐습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
        if (heroActs(context, AGGRESSIVE) && fraction < 0.5) return { grade: "miss", judgment: "작은 블러프는 정과장의 콜 구간에 걸립니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
        return { grade: "neutral", judgment: "체크는 EV 비교가 끝난 뒤 채점합니다.", recommendation: { actions: ["check", "bet"] }, countsAsOpportunity: false };
      }
      if (read.strength >= 0.55 && read.strength < 0.9) {
        if (heroActs(context, AGGRESSIVE) && fraction > 0 && fraction <= 0.48) return { grade: "success", judgment: "얇은 밸류에 맞는 작은 사이즈를 골랐습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.3, maxPotFraction: 0.4 } };
        return { grade: "miss", judgment: "얇은 밸류를 받기 어려운 큰 사이즈 또는 체크를 선택했습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.3, maxPotFraction: 0.4 } };
      }
      return null;
    },
  },
  {
    id: "uncleho.isolate_then_cbet",
    villainId: "uncleho",
    skill: "street_plan",
    expectedEdgeBb100: 20,
    headline: "삼촌의 림프는 아이솔레이션 뒤 플랍까지 압박합니다",
    evidence: "삼촌의 기본 flop fold는 63%이고 프리플랍 림프가 잦습니다.",
    principle: "루즈한 림프와 플랍 과폴드는 두 단계 계획으로 착취합니다.",
    condition: "삼촌이 림프하고 플레이 가능한 핸드가 오면",
    action: "4bb+림퍼당 1bb로 아이솔하고 헤즈업 플랍에 33~50% c-bet하세요.",
    exception: "앞선 레이즈·지나친 멀티웨이·하위 핸드는 제외합니다.",
    evaluate: (context) => {
      if (!headsUpWith(context, "uncleho")) return null;
      if (streetOf(context) === "preflop") {
        const actions = preflopActions(context);
        const limp = actions.find((action) => action.actorId === "uncleho" && action.type === "call" && action.toCall <= stateOf(context).bb);
        const priorRaise = limp && actions.slice(0, actions.indexOf(limp)).some((action) => AGGRESSIVE.includes(action.type));
        const threshold = ["BTN", "CO"].includes(heroPosition(context) ?? "") ? 35 : 20;
        if (!limp || priorRaise || heroPercentile(context) > threshold) return null;
        return heroActs(context, ["raise", "allin"])
          ? { grade: "success", judgment: "림프 범위를 아이솔레이션해 주도권을 잡았습니다.", recommendation: { actions: ["raise"] } }
          : { grade: "miss", judgment: "플레이 가능한 핸드로 림프를 수동적으로 따라갔습니다.", recommendation: { actions: ["raise"] } };
      }
      if (streetOf(context) === "flop" && lastWasCheckBy(context, "uncleho") && actorAggressedPreflop(context, "hero") && actorCalledPreflop(context, "uncleho")) {
        const fraction = heroPotFraction(context);
        const good = heroActs(context, AGGRESSIVE) && fraction >= 0.28 && fraction <= 0.55;
        return good
          ? { grade: "success", judgment: "아이솔레이션 뒤 작은 c-bet까지 계획을 완성했습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.33, maxPotFraction: 0.5 } }
          : { grade: "miss", judgment: "삼촌의 플랍 과폴드를 압박할 두 번째 단계를 놓쳤습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.33, maxPotFraction: 0.5 } };
      }
      return null;
    },
  },
  {
    id: "tourneymin.deep_stack_polarize",
    villainId: "tourneymin",
    skill: "stack_awareness",
    expectedEdgeBb100: 12,
    headline: "딥스택에서는 강한 패와 한 페어의 계획을 분리합니다",
    evidence: "토너꾼의 기본 성향은 탑페어로 100bb 팟에 과하게 커밋합니다.",
    principle: "상대의 탑페어 과커밋은 강한 패로 받되 같은 실수를 따라 하지 않습니다.",
    condition: "70bb 이상 포스트플랍에서 토너꾼과 헤즈업이면",
    action: "투페어 이상은 스택을 노리고 한 페어는 큰 재공격에 팟을 관리하세요.",
    exception: "숏스택·멀티웨이·강한 콤보드로는 EV 비교를 우선합니다.",
    evaluate: (context) => {
      const read = heroRead(context);
      if (!headsUpWith(context, "tourneymin") || streetOf(context) === "preflop" || effectiveStackBb(context, "tourneymin") < 70 || !read) return null;
      if (["twopair", "trips", "straight", "flush", "fullhouse", "nuts"].includes(read.made)) {
        return heroActs(context, AGGRESSIVE)
          ? { grade: "success", judgment: "과커밋 성향을 강한 밸류로 압박했습니다.", recommendation: { actions: ["bet", "raise", "allin"] } }
          : { grade: "miss", judgment: "딥스택에서 강한 패로 키울 밸류를 놓쳤습니다.", recommendation: { actions: ["bet", "raise", "allin"] } };
      }
      if (["toppair", "overpair"].includes(read.made) && facedAggressionBy(context, "tourneymin") && facedFraction(context, "tourneymin") >= 0.75) {
        return heroActs(context, ["raise", "allin"])
          ? { grade: "miss", judgment: "한 페어로 큰 재공격까지 자동 수락했습니다.", recommendation: { actions: ["fold", "call"] } }
          : { grade: "success", judgment: "한 페어로 불필요한 스택오프를 피했습니다.", recommendation: { actions: ["fold", "call"] } };
      }
      return null;
    },
  },
  {
    id: "vendetta.tilt_value_pressure",
    villainId: "vendetta",
    skill: "opponent_exploit",
    expectedEdgeBb100: 17,
    headline: "틸트 중인 복수의화신에게는 밸류로 압박합니다",
    evidence: "현재 런타임에서 TILT 상태와 남은 지속 시간이 확인됐습니다.",
    principle: "감정으로 넓어진 레인지는 블러프가 아니라 넓고 큰 밸류로 받습니다.",
    condition: "TILT 표시가 활성화된 동안",
    action: "강한 패는 75~100% 팟으로 받고 약한 패로 맞불 블러프하지 마세요.",
    exception: "대사나 단일 큰 벳만으로 틸트를 추정하지 않습니다.",
    evaluate: (context) => {
      const runtime = context.decision.runtimes.vendetta;
      const read = heroRead(context);
      if (!headsUpWith(context, "vendetta") || !runtime || runtime.emotion !== "TILT" || runtime.emotionRemainingHands <= 0 || !read) return null;
      if (read.strength >= 0.6 && lastWasCheckBy(context, "vendetta")) {
        const fraction = heroPotFraction(context);
        const good = heroActs(context, AGGRESSIVE) && fraction >= 0.65;
        return good
          ? { grade: "success", judgment: "틸트로 넓어진 콜 범위를 큰 밸류로 받았습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } }
          : { grade: "miss", judgment: "틸트 중 넓은 콜 범위에서 받을 밸류를 놓쳤습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
      }
      if (read.strength <= 0.35 && heroActs(context, AGGRESSIVE)) {
        return { grade: "miss", judgment: "틸트 상대에게 약한 패로 맞불 블러프했습니다.", recommendation: { actions: ["check", "fold"] } };
      }
      if (read.strength <= 0.35) return { grade: "success", judgment: "틸트 상대에게 불필요한 맞불 블러프를 피했습니다.", recommendation: { actions: ["check", "fold"] } };
      return null;
    },
  },
  {
    id: "slowroll.timing_tell_one_step",
    villainId: "slowroll",
    skill: "opponent_exploit",
    expectedEdgeBb100: 15,
    headline: "타이밍 텔은 경계 결정을 한 단계만 움직입니다",
    evidence: "슬로우롤의 타이밍 텔은 22% 역전되므로 보조 근거로만 씁니다.",
    principle: "불완전한 텔은 기본 EV가 팽팽한 결정만 한 단계 조정합니다.",
    condition: "기본 후보 EV 차이가 0.5bb 이하이고 액션이 매우 빠르거나 느리면",
    action: "3.5초 이상에는 콜을 넓히고 1.8초 이하는 한 단계 더 폴드하세요.",
    exception: "중간 시간대·멀티웨이·EV 차이 0.5bb 초과에서는 텔을 무시합니다.",
    confidenceCap: "medium",
    evaluate: (context) => {
      if (!headsUpWith(context, "slowroll") || !facedAggressionBy(context, "slowroll")) return null;
      const action = lastStreetAction(context);
      const gap = baselineCandidateGap(context);
      if (!action || gap === null || gap > 0.5 || (action.timeMs > 1800 && action.timeMs < 3500)) return null;
      const slow = action.timeMs >= 3500;
      const recommended: ActionType = slow ? "call" : "fold";
      if (context.decision.heroType === recommended) return { grade: "success", judgment: slow ? "느린 블러프 텔을 경계 범위 안에서 반영했습니다." : "빠른 강함 텔을 경계 범위 안에서 반영했습니다.", recommendation: { actions: [recommended] } };
      if (heroActs(context, ["call", "fold"])) return { grade: "miss", judgment: slow ? "느린 블러프 텔과 반대로 너무 일찍 접었습니다." : "빠른 강함 텔과 반대로 콜 범위를 넓혔습니다.", recommendation: { actions: [recommended] } };
      return null;
    },
  },
  {
    id: "weekend.sixty_bb_pressure",
    villainId: "weekend",
    skill: "stack_awareness",
    expectedEdgeBb100: 16,
    headline: "60bb를 넘긴 팟에서 주말전사의 위축을 압박합니다",
    evidence: "주말전사의 기본 성향은 60bb 이상 팟에서 폴드 빈도가 크게 오릅니다.",
    principle: "이 상대는 팟 크기 자체가 임계값을 넘으면 의사결정이 달라집니다.",
    condition: "팟이 60bb 이상이고 턴·리버에서 주말전사가 체크하면",
    action: "75~100% 팟의 큰 사이즈로 압박하세요.",
    exception: "60bb 미만이거나 주말전사가 먼저 큰 공격을 하면 제외합니다.",
    evaluate: (context) => {
      const street = streetOf(context);
      const potBb = potTotal(stateOf(context)) / Math.max(1, stateOf(context).bb);
      if (!headsUpWith(context, "weekend") || !street || !["turn", "river"].includes(street) || potBb < 60 || !lastWasCheckBy(context, "weekend")) return null;
      const fraction = heroPotFraction(context);
      if (heroActs(context, AGGRESSIVE) && fraction >= 0.65) return { grade: "success", judgment: "60bb 임계값 뒤 위축을 큰 사이즈로 압박했습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
      return { grade: "miss", judgment: "60bb를 넘긴 팟에서 커진 폴드 성향을 압박하지 못했습니다.", recommendation: { actions: ["bet"], minPotFraction: 0.75, maxPotFraction: 1 } };
    },
  },
] as const;

export function evaluateExploitRules(context: RuleContext): ExploitRuleResult[] {
  const matches: ExploitRuleResult[] = [];
  for (const definition of EXPLOIT_RULES) {
    const assessment = definition.evaluate(context);
    if (!assessment) continue;
    const { evaluate: _evaluate, ...metadata } = definition;
    matches.push(result(metadata, assessment));
  }
  return matches.sort((left, right) => {
    const gradeWeight = (grade: RuleGrade) => grade === "miss" ? 2 : grade === "success" ? 1 : 0;
    return gradeWeight(right.grade) - gradeWeight(left.grade) || right.expectedEdgeBb100 - left.expectedEdgeBb100;
  });
}

export function primaryExploitRule(context: RuleContext): ExploitRuleResult | undefined {
  return evaluateExploitRules(context)[0];
}
