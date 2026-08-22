import { evaluate5, evaluateBest } from "./handRank";
import { parseCard } from "./cards";
import { applyAction, createFreshPlayers, startHand } from "./game";
import { Rng } from "./rng";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const royal = evaluate5(["As", "Ks", "Qs", "Js", "Ts"].map(parseCard));
const wheel = evaluate5(["Ah", "2d", "3c", "4s", "5h"].map(parseCard));
assert(royal.category === 8, "royal should be SF");
assert(wheel.category === 4, "wheel should be straight");
assert(royal.value > wheel.value, "royal > wheel");

const quads = evaluateBest(["Ah", "Ad", "Ac", "As", "2h", "2d", "9c"].map(parseCard));
assert(quads.category === 7, "quads");

const players = createFreshPlayers(["hero", "a", "b", "c", "d", "e"]);
let state = startHand({ players, button: 0, handNumber: 1, seed: "test" });
let guard = 0;
while (state.street !== "complete" && guard++ < 80) {
  if (state.toAct === null) break;
  state = applyAction(state, "fold");
}
assert(state.street === "complete", "fold-out should complete");
assert(!!state.result, "result exists");

const rng = new Rng(1);
for (let i = 0; i < 40; i++) {
  let s = startHand({
    players: createFreshPlayers(["hero", "a", "b", "c", "d", "e"]),
    button: i % 6,
    handNumber: i + 1,
    seed: `sim${i}`,
  });
  let n = 0;
  while (s.street !== "complete" && n++ < 120) {
    if (s.toAct === null) break;
    const r = rng.float();
    if (r < 0.35) s = applyAction(s, "fold");
    else if (r < 0.75) s = applyAction(s, s.currentBet === s.players[s.toAct].contributedStreet ? "check" : "call");
    else s = applyAction(s, "raise", s.currentBet + 200 + s.players[s.toAct].contributedStreet);
  }
  assert(s.street === "complete", `hand ${i} completed`);
}

console.log("selftest ok");
