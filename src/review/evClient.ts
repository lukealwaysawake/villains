import type { TableState } from "../engine/game";
import type { ActionType } from "../engine/types";
import type { VillainRuntime } from "../villains/types";
import type { DecisionEv } from "./ev";

let worker: Worker | null = null;

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./evWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function scoreDecisionAsync(job: {
  state: TableState;
  runtimes: Record<string, VillainRuntime>;
  heroType: ActionType;
  heroRaiseTo: number;
  samples?: number;
  tell?: number;
}): Promise<DecisionEv | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    const onMsg = (event: MessageEvent<{ ok: boolean; scored?: DecisionEv }>) => {
      clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      resolve(event.data.ok && event.data.scored ? event.data.scored : null);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({
      ...job,
      samples: job.samples ?? 24,
      tell: job.tell ?? 0.78,
    });
  });
}
