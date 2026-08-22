import { chipsToBb } from "../engine/types";
import type { TableState } from "../engine/game";
import { VILLAIN_BY_ID } from "./catalog";
import type { TriggerType, VillainRuntime } from "./types";

export interface SpeechEvent {
  villainId: string;
  line: string;
  trigger: TriggerType;
}

function pickLine(runtime: VillainRuntime, trigger: TriggerType, handNumber: number): string | null {
  const def = VILLAIN_BY_ID[runtime.villainId];
  const pool = def.lines[trigger];
  if (!pool?.length) return null;
  if (runtime.sessionSpeechCount >= 25) return null;
  if ((runtime.dialogueCooldowns[trigger] ?? -99) + 2 >= handNumber) return null;
  let p = def.verbosity;
  if (def.id === "vendetta" && runtime.emotion === "TILT") p = 0.55;
  if (runtime.lastTrigger === trigger) p *= 0.3;
  if (Math.random() > p) return null;
  const unused = pool.filter((l) => l !== runtime.lastLine);
  const source = unused.length ? unused : pool;
  const line = source[Math.floor(Math.random() * source.length)];
  runtime.lastLine = line;
  runtime.lastTrigger = trigger;
  runtime.sessionSpeechCount += 1;
  runtime.dialogueCooldowns[trigger] = handNumber;
  return line;
}

export function maybeSpeak(runtime: VillainRuntime, trigger: TriggerType, handNumber: number): SpeechEvent | null {
  const line = pickLine(runtime, trigger, handNumber);
  if (!line) return null;
  return { villainId: runtime.villainId, line, trigger };
}

export function onHandEnd(args: {
  state: TableState;
  runtimes: Record<string, VillainRuntime>;
  heroFoldStreak: number;
}): SpeechEvent[] {
  const speeches: SpeechEvent[] = [];
  const result = args.state.result;
  if (!result) return speeches;

  for (const p of args.state.players) {
    if (p.id === "hero") continue;
    const rt = args.runtimes[p.id];
    if (!rt) continue;
    const def = VILLAIN_BY_ID[p.id];
    const delta = result.deltas[p.id] ?? 0;
    const bb = chipsToBb(delta, args.state.bb);

    if (rt.emotionRemainingHands > 0) {
      rt.emotionRemainingHands -= 1;
      if (rt.emotionRemainingHands <= 0) rt.emotion = "NORMAL";
    }

    const bigLoss = bb <= -def.emotionProfile.tiltThreshold;
    const hero = args.state.players.find((x) => x.id === "hero")!;
    const heroBluffShown =
      !!result.shown[hero.seat] &&
      (result.deltas.hero ?? 0) > 0 &&
      args.state.actionLog.some((a) => a.actorId === "hero" && (a.type === "bet" || a.type === "raise") && a.street === "river");

    if (def.emotionProfile.sensitivity > 0 && (bigLoss || (def.id === "vendetta" && heroBluffShown))) {
      rt.emotion = "TILT";
      rt.emotionRemainingHands = def.emotionProfile.tiltDuration;
      const s = maybeSpeak(rt, "TILT_ENTER", args.state.handNumber);
      if (s) speeches.push(s);
    } else if (bb <= -25 && def.emotionProfile.sensitivity >= 1) {
      rt.emotion = "SCARED";
      rt.emotionRemainingHands = 8;
      const s = maybeSpeak(rt, "SCARED_ENTER", args.state.handNumber);
      if (s) speeches.push(s);
    } else if (p.stack >= 120 * args.state.bb && def.emotionProfile.sensitivity > 0) {
      if (rt.emotion === "NORMAL" && Math.random() < 0.2) {
        rt.emotion = "CONFIDENT";
        rt.emotionRemainingHands = 10;
      }
    }

    if (bb >= 20) {
      const s = maybeSpeak(rt, "WIN_BIG", args.state.handNumber);
      if (s) speeches.push(s);
    } else if (bb <= -20) {
      const s = maybeSpeak(rt, "LOSE_BIG", args.state.handNumber);
      if (s) speeches.push(s);
    }

    if (heroBluffShown) {
      const s = maybeSpeak(rt, "HERO_BLUFF_SHOWN", args.state.handNumber);
      if (s) speeches.push(s);
    }

    const lead = Math.max(...args.state.players.map((x) => x.stack));
    if (p.stack === lead && p.stack > 11000) {
      const s = maybeSpeak(rt, "STACK_LEAD", args.state.handNumber);
      if (s) speeches.push(s);
    }
  }

  if (args.heroFoldStreak >= 15) {
    const list = Object.values(args.runtimes);
    const chatter = list[Math.floor(Math.random() * list.length)];
    const s = maybeSpeak(chatter, "LONG_FOLD", args.state.handNumber);
    if (s) speeches.push(s);
  }

  return speeches;
}

export function sessionStartLines(runtimes: Record<string, VillainRuntime>): SpeechEvent[] {
  const out: SpeechEvent[] = [];
  for (const rt of Object.values(runtimes)) {
    const s = maybeSpeak(rt, "SESSION_START", 0);
    if (s) out.push(s);
  }
  return out;
}

export function updateHeroRead(rt: VillainRuntime, state: TableState): void {
  rt.heroRead.hands += 1;
  const heroActs = state.actionLog.filter((a) => a.actorId === "hero");
  const bets = heroActs.filter((a) => a.type === "bet" || a.type === "raise" || a.type === "allin").length;
  rt.heroRead.avgAggression = rt.heroRead.avgAggression * 0.9 + (bets / Math.max(1, heroActs.length)) * 0.1;

  const facedCbet = state.actionLog.some((a) => a.actorId === rt.villainId && a.street === "flop" && (a.type === "bet" || a.type === "raise"));
  const heroFoldFlop = heroActs.some((a) => a.street === "flop" && a.type === "fold");
  if (facedCbet) {
    rt.heroRead.cbetFoldRate = rt.heroRead.cbetFoldRate * 0.85 + (heroFoldFlop ? 0.15 : 0);
  }
  const three = heroActs.some((a) => a.street === "preflop" && (a.type === "raise" || a.type === "allin") && a.toCall >= state.bb);
  rt.heroRead.threeBetFreq = rt.heroRead.threeBetFreq * 0.92 + (three ? 0.08 : 0);

  const over = state.actionLog.find((a) => a.actorId === rt.villainId && a.street === "river" && a.amount >= a.potBefore * 1.15);
  if (over) {
    rt.heroRead.overbetFaced += 1;
    const folded = heroActs.some((a) => a.street === "river" && a.type === "fold");
    rt.heroRead.foldToOverbet =
      (rt.heroRead.foldToOverbet * (rt.heroRead.overbetFaced - 1) + (folded ? 1 : 0)) / rt.heroRead.overbetFaced;
    if (rt.villainId === "ceokim" && folded && rt.heroRead.foldToOverbet > 0.7 && rt.heroRead.overbetFaced >= 3) {
      rt.overbetBluffBoostUntil = state.handNumber + 25;
    }
  }

  if (rt.villainId === "greatwhite") {
    if (rt.heroRead.cbetFoldRate > 0.55 && rt.heroRead.hands >= 12) rt.cbetBoost = 78;
    if (rt.heroRead.threeBetFreq > 0.12 && rt.heroRead.hands >= 16) rt.fourBetBoost = 2;
  }
}
