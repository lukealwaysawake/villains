import { madeLabel, readSpot } from "../engine/handRank";
import type { TableState } from "../engine/game";
import { BB, chipsToBb, type ReviewSeverity, type Street } from "../engine/types";
import { VILLAIN_BY_ID } from "../villains/catalog";

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
}

function worstVillain(state: TableState): string | undefined {
  const ids = state.players.filter((p) => p.id !== "hero" && !p.folded).map((p) => p.id);
  return ids[0];
}

function heroDecisions(state: TableState) {
  return state.actionLog.filter((a) => a.actorId === "hero");
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
  const resultBb = chipsToBb(state.result?.heroDelta ?? 0);
  let loss = 0;
  let headline = "무난한 핸드";
  let body = "큰 실수는 안 보였습니다.";
  let alt = "다음 핸드에서 상대 HUD만 한 번 더 보세요.";
  let statLabel = "결과";
  let statValue = `${resultBb >= 0 ? "+" : ""}${resultBb}bb`;
  let leak: string | undefined;

  const riverBet = acts.find((a) => a.street === "river" && (a.type === "bet" || a.type === "raise"));
  const riverFold = acts.find((a) => a.street === "river" && a.type === "fold");
  const preRaise = acts.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin"));
  const heroHole = hero.hole;

  if (opp && riverBet) {
    const foldRiver = opp.baseStats.foldToCbetRiver;
    if (opp.id === "stationpark" || foldRiver <= 18) {
      loss = Math.max(2.4, chipsToBb(riverBet.amount) * (1 - foldRiver / 100));
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

  if (opp?.id === "uncleho" && street === "preflop" && last?.type === "call" && last.toCall <= BB) {
    const limped = state.actionLog.some((a) => a.actorId === "uncleho" && a.type === "call" && a.street === "preflop" && a.toCall <= BB);
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

  if (opp?.id === "weekend" && last?.type === "check" && street === "turn" && last.potBefore >= 40 * BB) {
    loss = Math.max(loss, 3.5);
    headline = "큰 팟에서 주말전사를 놓침";
    body = "팟이 60bb를 넘으면 주말전사의 폴드 빈도가 급등합니다. 사이징을 키우세요.";
    statLabel = "60bb+ 폴드 가산";
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
    gtoLine: "GTO 기준: 밸런스 혼합. 블러프 빈도는 상대가 폴드하는 만큼만.",
    exploitLine: body,
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
