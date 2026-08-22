import { madeLabel, readSpot } from "../engine/handRank";
import { RANK_GLYPH, SUIT_GLYPH } from "../engine/cards";
import { describeAction, type TableState } from "../engine/game";
import { chipsToBb, type ReviewSeverity, type Street } from "../engine/types";
import { VILLAIN_BY_ID } from "../villains/catalog";
import type { DecisionEv } from "./ev";

export interface StreetReview {
  street: Street;
  label: string;
  board: string;
  made: string;
  actions: string;
  potBb: number;
  note: string;
}

export interface ReviewCard {
  id: string;
  handNumber: number;
  severity: ReviewSeverity;
  totalLossBb: number;
  street: Street | "showdown";
  headline: string;
  body: string;
  alt: string;
  statLabel: string;
  statValue: string;
  leak?: string;
  villainId?: string;
  viewed: boolean;
  bigBlindDollars?: number;
  streets?: StreetReview[];
  gtoLine?: string;
  exploitLine?: string;
  candidates?: { label: string; ev: number }[];
}

function worstVillain(state: TableState): string | undefined {
  const ids = state.players.filter((p) => p.id !== "hero" && !p.folded).map((p) => p.id);
  return ids[0];
}

function heroDecisions(state: TableState) {
  return state.actionLog.filter((a) => a.actorId === "hero");
}

function signedDollarsFromChips(chips: number): string {
  const dollars = Math.round((Math.abs(chips) / 100) * 100) / 100;
  const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2).replace(/0$/, "");
  return `${chips > 0 ? "+" : chips < 0 ? "−" : ""}$${body}`;
}

export function analyzeHand(state: TableState): ReviewCard {
  const acts = heroDecisions(state);
  const last = acts[acts.length - 1];
  const street = (last?.street ?? "preflop") as Street;
  const hero = state.players.find((p) => p.id === "hero")!;
  const oppId = last
    ? [...state.actionLog].reverse().find((a) => a.actorId !== "hero" && a.street === last.street)?.actorId ?? worstVillain(state)
    : worstVillain(state);
  const opp = oppId ? VILLAIN_BY_ID[oppId] : undefined;
  const resultBb = chipsToBb(state.result?.heroDelta ?? 0, state.bb);
  let loss = 0;
  let headline = "무난한 핸드";
  let body = "큰 실수는 안 보였습니다.";
  let alt = "다음 핸드에서 상대 HUD만 한 번 더 보세요.";
  let statLabel = "결과";
  let statValue = signedDollarsFromChips(state.result?.heroDelta ?? 0);
  let leak: string | undefined;

  const riverBet = acts.find((a) => a.street === "river" && (a.type === "bet" || a.type === "raise"));
  const preRaise = acts.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin"));
  const heroHole = hero.hole;

  if (opp && riverBet) {
    const foldRiver = opp.baseStats.foldToCbetRiver;
    if (opp.id === "stationpark" || foldRiver <= 18) {
      loss = Math.max(2.4, chipsToBb(riverBet.amount, state.bb) * (1 - foldRiver / 100));
      headline = `${opp.name}에게 리버 블러프`;
      body = `${opp.name}의 fold to river bet은 ${opp.id === "stationpark" ? 12 : foldRiver}%입니다. 이 상대에게 블러프는 성립하지 않습니다. 체크가 정답입니다.`;
      alt = "밸류만 크게 베팅하세요.";
      statLabel = `${opp.name} 리버 폴드`;
      statValue = `${opp.id === "stationpark" ? 12 : foldRiver}%`;
      leak = "FOLD_FREQ";
    }
    if (opp.id === "foldjeong" && riverBet.amount < riverBet.potBefore * 0.5) {
      loss = 3.2;
      headline = "정과장에게 작은 블러프";
      body = "정과장은 작은 벳은 거의 다 콜하고 큰 벳은 접습니다. 블러프는 팟 75% 이상이어야 합니다.";
      alt = "밸류는 작게, 블러프는 크게.";
      statLabel = "큰 벳 폴드";
      statValue = "71%";
      leak = "SIZING_TELL";
    }
  }

  if (opp?.id === "nitlee" && last?.type === "call" && last.street !== "preflop" && last.toCall >= last.potBefore * 0.6) {
    loss = Math.max(loss, 6);
    headline = "이대리의 큰 벳을 콜";
    body = "이대리의 레인지가 극도로 좁습니다. 큰 벳이나 리버 레이즈는 거의 항상 밸류입니다.";
    alt = "닛이 세게 치면 접으세요.";
    statLabel = "이대리 VPIP";
    statValue = "15%";
    leak = "RANGE";
  }

  if (opp?.id === "uncleho" && street === "preflop" && last?.type === "call" && last.toCall <= state.bb) {
    const limped = state.actionLog.some((a) => a.actorId === "uncleho" && a.type === "call" && a.street === "preflop" && a.toCall <= state.bb);
    if (limped) {
      loss = Math.max(loss, 2.1);
      headline = "삼촌 림프를 그냥 콜";
      body = "삼촌은 림프를 사랑하고 플랍을 잘 접습니다. 아이솔레이션 레이즈 후 c-bet이 정석입니다.";
      alt = "림퍼 뒤에는 아이솔.";
      statLabel = "삼촌 플랍 폴드";
      statValue = "63%";
      leak = "FOLD_FREQ";
    }
  }

  if (opp?.id === "bulldozer" && last?.type === "fold" && last.street === "flop") {
    loss = Math.max(loss, 2.8);
    headline = "불도저 플랍 c-bet에 접음";
    body = "불도저는 플랍을 82% 벳하고 턴 배럴은 38%입니다. 플랍은 콜하고 턴에서 뺏는 핸드입니다.";
    alt = "스트리트 갭을 노리세요.";
    statLabel = "턴 배럴";
    statValue = "38%";
    leak = "STREET_GAP";
  }

  if (opp?.id === "irongate" && last?.street === "flop" && last.type === "check") {
    loss = Math.max(loss, 1.8);
    headline = "철벽 OOP에 c-bet 스킵";
    body = "철벽은 블라인드에서 플랍 c-bet에 68% 접습니다. 공짜 돈이 걸려 있습니다.";
    statLabel = "OOP 플랍 폴드";
    statValue = "68%";
    leak = "POSITIONAL";
  }

  if (opp?.id === "weekend" && last?.type === "check" && street === "turn" && last.potBefore >= 40 * state.bb) {
    loss = Math.max(loss, 3.5);
    headline = "큰 팟에서 주말전사를 놓침";
    const scarePot = signedDollarsFromChips(60 * state.bb).replace("+", "");
    body = `팟이 ${scarePot}를 넘으면 주말전사의 폴드 빈도가 급등합니다. 사이징을 키우세요.`;
    statLabel = `${scarePot}+ 폴드 가산`;
    statValue = "+35%p";
    leak = "STACK_MISREAD";
  }

  if (opp?.id === "ceokim" && lastRaiseOver(state) && last?.type === "call") {
    loss = Math.max(loss, 5.4);
    headline = "김대표 오버벳을 콜";
    body = "김대표의 리버 오버벳 블러프는 14%입니다. 마진 핸드는 전부 폴드가 맞습니다.";
    statLabel = "오버벳 블러프";
    statValue = "14%";
    leak = "SIZING_TELL";
  }

  if (opp?.id === "songtag" && preRaise.length >= 2) {
    /* light 4bet is good */
  } else if (opp?.id === "songtag" && preRaise.length === 1 && last?.type === "fold" && last.street === "preflop") {
    /* ok */
  }

  if (heroHole && state.board.length >= 3 && last) {
    const read = readSpot(heroHole, state.board);
    if (opp?.id === "stationpark" && last.type === "fold" && read.strength >= 0.4) {
      loss = Math.max(loss, 4.2);
      headline = "박사장에게 밸류를 접음";
      body = `지금 핸드(${madeLabel(read.made)})면 박사장에게는 밸류입니다. 이 상대는 탑페어까지 따라옵니다.`;
      statLabel = "박사장 WTSD";
      statValue = "41%";
      leak = "FOLD_FREQ";
    }
  }

  if (!last) {
    headline = "워크오버";
    body = "액션 없이 끝난 핸드입니다.";
    loss = 0;
  }

  if (loss < 0.8) {
    return {
      id: `${state.seed}-${state.handNumber}`,
      handNumber: state.handNumber,
      severity: "green",
      totalLossBb: 0,
      street,
      headline: resultBb >= 8 ? "큰 팟 획득" : "괜찮은 핸드",
      body: resultBb >= 0 ? "착취 기준에서 큰 누수는 없었습니다." : "결과는 졌지만 라인 자체는 무난합니다.",
      alt,
      statLabel,
      statValue,
      leak,
      villainId: opp?.id,
      viewed: false,
      bigBlindDollars: state.bb / 100,
      streets: analyzeStreets(state),
    };
  }

  const severity: ReviewSeverity = loss >= 5 ? "red" : "yellow";
  return {
    id: `${state.seed}-${state.handNumber}`,
    handNumber: state.handNumber,
    severity,
    totalLossBb: Math.round(loss * 10) / 10,
    street,
    headline,
    body,
    alt,
    statLabel,
    statValue,
    leak,
    villainId: opp?.id,
    viewed: false,
    bigBlindDollars: state.bb / 100,
    streets: analyzeStreets(state),
    gtoLine: "GTO 기준: 밸런스 혼합. 블러프 빈도는 상대가 폴드하는 만큼만.",
    exploitLine: body,
  };
}

export function mergeDecisionScores(review: ReviewCard, scores: DecisionEv[]): ReviewCard {
  if (scores.length === 0) return review;
  const worst = scores.reduce((a, b) => (b.lossBb > a.lossBb ? b : a));
  const loss = Math.max(review.totalLossBb, worst.lossBb);
  const evDominates = worst.lossBb >= 0.8 && worst.lossBb > review.totalLossBb;
  const severity: ReviewSeverity = loss >= 5 ? "red" : loss >= 0.8 ? "yellow" : "green";
  const playedEv = `${worst.played.ev >= 0 ? "+" : ""}${worst.played.ev.toFixed(1)}bb`;
  const bestEv = `${worst.best.ev >= 0 ? "+" : ""}${worst.best.ev.toFixed(1)}bb`;

  return {
    ...review,
    severity,
    totalLossBb: Math.round(loss * 10) / 10,
    street: evDominates ? worst.street : review.street,
    headline: evDominates ? `${STREET_KO[worst.street]} 선택에서 ${worst.lossBb.toFixed(1)}bb 손실` : review.headline,
    body: evDominates
      ? `${worst.played.label}의 추정 EV는 ${playedEv}, ${worst.best.label}는 ${bestEv}입니다. 같은 숨은 카드 표본에서 더 나은 선택이 확인됐습니다.`
      : review.body,
    alt: evDominates ? `${worst.best.label} 라인을 우선 검토하세요.` : review.alt,
    statLabel: evDominates ? "간이 EV 차이" : review.statLabel,
    statValue: evDominates ? `${worst.lossBb.toFixed(1)}bb` : review.statValue,
    gtoLine: "상대가 모르는 홀카드와 남은 보드를 같은 시드 표본으로 다시 나눠 후보 행동의 기대값을 비교합니다.",
    exploitLine: `착취 기준 최적: ${worst.best.label} (${bestEv})`,
    candidates: worst.candidates.map((candidate) => ({ label: candidate.label, ev: candidate.ev })),
  };
}

function lastRaiseOver(state: TableState): boolean {
  const last = [...state.actionLog].reverse().find((a) => a.street === "river" && a.actorId !== "hero" && (a.type === "bet" || a.type === "raise" || a.type === "allin"));
  return !!last && last.amount >= last.potBefore * 1.15;
}

export function detectPatterns(reviews: ReviewCard[]): { tag: string; count: number; loss: number }[] {
  const map = new Map<string, { count: number; loss: number }>();
  for (const r of reviews) {
    if (r.severity === "green") continue;
    const tag = r.headline;
    const cur = map.get(tag) ?? { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += r.totalLossBb;
    map.set(tag, cur);
  }
  return [...map.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 3);
}

const STREET_KO: Record<Street, string> = {
  preflop: "프리플랍",
  flop: "플랍",
  turn: "턴",
  river: "리버",
};

const BOARD_COUNT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export function analyzeStreets(state: TableState): StreetReview[] {
  const hero = state.players.find((p) => p.id === "hero");
  if (!hero || !hero.hole) return [];
  const out: StreetReview[] = [];
  const order: Street[] = ["preflop", "flop", "turn", "river"];
  for (const street of order) {
    const acts = state.actionLog.filter((x) => x.street === street);
    const mine = acts.filter((x) => x.actorId === "hero");
    if (mine.length === 0) continue;
    const shownBoard = state.board.slice(0, BOARD_COUNT[street]);
    const read = shownBoard.length >= 3 ? readSpot(hero.hole, shownBoard) : null;
    const potBb = chipsToBb(mine[0].potBefore, state.bb);
    const faced = acts.filter((x) => x.actorId !== "hero" && (x.type === "bet" || x.type === "raise" || x.type === "allin"));
    const aggro = mine.some((x) => x.type === "bet" || x.type === "raise" || x.type === "allin");
    const folded = mine.some((x) => x.type === "fold");
    const called = mine.some((x) => x.type === "call");

    let note = "무난";
    if (folded) note = faced.length ? "상대 압박에 포기" : "액션 없이 포기";
    else if (aggro) note = faced.length ? "되받아 압박" : "주도권 잡음";
    else if (called) note = read && read.strength < 0.35 ? "약한 패로 콜" : "콜로 따라감";
    else note = "체크로 넘김";

    out.push({
      street,
      label: STREET_KO[street],
      board: shownBoard.map((c) => RANK_GLYPH[c.rank] + SUIT_GLYPH[c.suit]).join(" ") || "—",
      made: read ? madeLabel(read.made) : "프리플랍",
      actions: mine.map((x) => describeAction(x)).join(" · "),
      potBb: Math.round(potBb * 10) / 10,
      note,
    });
  }
  return out;
}
