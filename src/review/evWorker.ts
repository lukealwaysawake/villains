import { scoreDecision } from "./ev";
import type { TableState } from "../engine/game";
import type { ActionType } from "../engine/types";
import type { VillainRuntime } from "../villains/types";

type Job = {
  state: TableState;
  runtimes: Record<string, VillainRuntime>;
  heroType: ActionType;
  heroRaiseTo: number;
  samples: number;
  tell: number;
};

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  try {
    const scored = scoreDecision(job.state, job.heroType, job.heroRaiseTo, job.runtimes, job.samples);
    (self as unknown as Worker).postMessage({ ok: true, scored });
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(error) });
  }
};
