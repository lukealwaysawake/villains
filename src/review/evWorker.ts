import { scoreDecisions } from "./ev";
import type { DecisionSnapshot } from "./ev";

type Job = {
  id: number;
  decisions: DecisionSnapshot[];
  samples: number;
  tell: number;
};

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  try {
    const scored = scoreDecisions(job.decisions, job.samples, job.tell);
    (self as unknown as Worker).postMessage({ id: job.id, ok: true, scored });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, error: String(error) });
  }
};
