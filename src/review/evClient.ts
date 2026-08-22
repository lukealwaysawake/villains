import type { TableState } from "../engine/game";
import type { ActionType } from "../engine/types";
import type { VillainRuntime } from "../villains/types";
import type { DecisionEv, DecisionSnapshot } from "./ev";

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (value: DecisionEv[] | null) => void; timer: ReturnType<typeof setTimeout> }>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./evWorker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<{ id: number; ok: boolean; scored?: DecisionEv[] }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      clearTimeout(job.timer);
      pending.delete(event.data.id);
      job.resolve(event.data.ok && event.data.scored ? event.data.scored : null);
    });
    worker.addEventListener("error", () => {
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.resolve(null);
      }
      pending.clear();
      worker = null;
    });
  }
  return worker;
}

export function scoreDecisionsAsync(job: {
  decisions: DecisionSnapshot[];
  samples?: number;
  tell?: number;
}): Promise<DecisionEv[] | null> {
  if (job.decisions.length === 0) return Promise.resolve([]);
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++requestId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 6000);
    pending.set(id, { resolve, timer });
    w.postMessage({
      id,
      decisions: job.decisions,
      samples: job.samples ?? 24,
      tell: job.tell ?? 0.78,
    });
  });
}

export function scoreDecisionAsync(job: {
  state: TableState;
  runtimes: Record<string, VillainRuntime>;
  heroType: ActionType;
  heroRaiseTo: number;
  samples?: number;
  tell?: number;
}): Promise<DecisionEv | null> {
  return scoreDecisionsAsync({
    decisions: [{ snapshot: job.state, runtimes: job.runtimes, heroType: job.heroType, heroRaiseTo: job.heroRaiseTo }],
    samples: job.samples,
    tell: job.tell,
  }).then((scored) => scored?.[0] ?? null);
}
