import type { TableState } from "../engine/game";
import { legalActions, positionFor } from "../engine/game";

export function coachLine(state: TableState): string | null {
  if (state.toAct !== 0 || state.street === "complete") return null;
  const legal = legalActions(state, 0);
  const uncle = state.players.find((p) => p.id === "uncleho" && !p.folded);
  const nit = state.players.find((p) => p.id === "nitlee" && !p.folded);
  const park = state.players.find((p) => p.id === "stationpark" && !p.folded);

  if (state.street === "preflop" && uncle) {
    const limp = state.actionLog.some((a) => a.actorId === "uncleho" && a.type === "call" && a.toCall <= state.bb);
    if (limp && legal.canBet) return "삼촌이 림프했습니다. 이런 상대는 아이솔레이션 레이즈로 압박하세요.";
  }
  if (state.street === "preflop" && nit) {
    const open = state.actionLog.some((a) => a.actorId === "nitlee" && (a.type === "raise" || a.type === "bet"));
    if (open) return "이대리가 오픈하면 대부분 진짜입니다. 3벳하면 82%가 팟을 줍니다. 되받으면 접으세요.";
  }
  if (park && (state.street === "turn" || state.street === "river") && legal.canBet && legal.callAmount === 0) {
    return "박사장은 거의 안 접습니다. 블러프 금지. 밸류만 크게 베팅하세요.";
  }
  if (park && legal.canCall && state.street === "river") {
    return "박사장 리버 벳은 밸류로 보세요. 세컨페어 이상이면 콜이 기본입니다.";
  }
  const pos = positionFor(state.button, 0, state.players.length);
  if (pos === "BTN" && state.street === "preflop" && legal.canBet && legal.callAmount <= state.bb) {
    return "버튼입니다. 타이트한 상대의 블라인드는 훔치는 연습 구간입니다.";
  }
  return null;
}
