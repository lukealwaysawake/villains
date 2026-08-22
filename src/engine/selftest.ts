import { evaluate5, evaluateBest } from "./handRank";
import { parseCard } from "./cards";
import { applyAction, createFreshPlayers, positionFor, startHand } from "./game";
import { Rng } from "./rng";
import { canContinueSession, createSession, dealNext, defaultRoom } from "../state/store";

let assertions = 0;
function assert(cond: boolean, msg: string) {
  assertions += 1;
  if (!cond) throw new Error(msg);
}

const royal = evaluate5(["As", "Ks", "Qs", "Js", "Ts"].map(parseCard));
const wheel = evaluate5(["Ah", "2d", "3c", "4s", "5h"].map(parseCard));
assert(royal.category === 8, "royal should be SF");
assert(wheel.category === 4, "wheel should be straight");
assert(royal.value > wheel.value, "royal > wheel");

const quads = evaluateBest(["Ah", "Ad", "Ac", "As", "2h", "2d", "9c"].map(parseCard));
assert(quads.category === 7, "quads");
assert(positionFor(0, 0, 2) === "SB" && positionFor(0, 1, 2) === "BB", "heads-up positions should show SB and BB");

const players = createFreshPlayers(["hero", "a", "b", "c", "d", "e"]);
let state = startHand({ players, button: 0, handNumber: 1, seed: "test" });
let guard = 0;
while (state.street !== "complete" && guard++ < 80) {
  if (state.toAct === null) break;
  state = applyAction(state, "fold");
}
assert(state.street === "complete", "fold-out should complete");
assert(!!state.result, "result exists");

const emptyPlayers = createFreshPlayers(["hero", "a"]);
for (const player of emptyPlayers) player.stack = 0;
const empty = startHand({ players: emptyPlayers, button: 0, handNumber: 2, seed: "empty", autoRebuy: false });
assert(empty.street === "complete", "zero-stack table should complete without crashing");
assert(!!empty.result && empty.result.winnersByPot.length === 0, "zero-stack table should have an empty result");

const shortPlayers = createFreshPlayers(["hero", "a"]);
shortPlayers[0].stack = 100;
shortPlayers[1].stack = 100;
let short = startHand({ players: shortPlayers, button: 0, handNumber: 3, seed: "short", autoRebuy: false, sb: 50, bb: 100 });
assert(short.toAct === 0, "small blind should act when the big blind is all-in");
short = applyAction(short, "call");
assert(short.street === "complete", "blind all-ins should run out instead of freezing");
assert(short.board.length === 5 && !!short.result, "blind all-ins should reach showdown");

let foldedHero = startHand({
  players: createFreshPlayers(["hero", "a", "b", "c"]),
  button: 0,
  handNumber: 4,
  seed: "hero-fold",
});
while (foldedHero.street !== "complete" && foldedHero.toAct !== 0) {
  const acting = foldedHero.players[foldedHero.toAct!];
  foldedHero = applyAction(foldedHero, foldedHero.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(foldedHero.toAct === 0, "hero should receive a preflop action");
foldedHero = applyAction(foldedHero, "fold");
assert(foldedHero.players[0].folded, "hero fold should be recorded");
assert(foldedHero.street !== "complete" && foldedHero.toAct !== 0, "multiway hand should continue after hero folds");
let foldGuard = 0;
while (foldedHero.street !== "complete" && foldGuard++ < 80) {
  assert(foldedHero.toAct !== null && foldedHero.toAct !== 0, "folded hero must not act again");
  const acting = foldedHero.players[foldedHero.toAct!];
  foldedHero = applyAction(foldedHero, foldedHero.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(foldedHero.street === "complete" && !!foldedHero.result, "villains should finish the hand after hero folds");

let uncontested = startHand({
  players: createFreshPlayers(["hero", "a", "b"]),
  button: 0,
  handNumber: 5,
  seed: "uncontested",
});
uncontested = applyAction(uncontested, "fold");
uncontested = applyAction(uncontested, "fold");
assert(uncontested.street === "complete", "second fold should complete an uncontested pot");
assert(uncontested.result?.winnersByPot[0]?.seats[0] === 2, "big blind should win the uncontested pot");
assert(uncontested.result?.winnersByPot.reduce((sum, pot) => sum + pot.amount, 0) === 150, "uncontested winner should receive both blinds");
assert(uncontested.players[2].stack === 10050, "uncontested pot should be credited to the winner");

const sidePotPlayers = createFreshPlayers(["hero", "a", "b"]).map((player) => ({
  ...player,
  stack: player.id === "hero" ? 300 : 1000,
}));
let sidePot = startHand({ players: sidePotPlayers, button: 0, handNumber: 6, seed: "all-in-side-pot" });
sidePot = applyAction(sidePot, "allin", 300);
assert(sidePot.players[0].allIn && sidePot.toAct === 1, "hero all-in should pass action to a remaining player");
sidePot = applyAction(sidePot, "raise", 600);
assert(sidePot.toAct === 2, "remaining player raise should keep action moving");
sidePot = applyAction(sidePot, "call");
let sideGuard = 0;
while (sidePot.street !== "complete" && sideGuard++ < 40) {
  assert(sidePot.toAct !== null && sidePot.toAct !== 0, "all-in hero must not act again");
  const acting = sidePot.players[sidePot.toAct!];
  sidePot = applyAction(sidePot, sidePot.currentBet === acting.contributedStreet ? "check" : "call");
}
assert(sidePot.street === "complete" && sidePot.board.length === 5, "all-in hand should reach a full-board result");
assert(sidePot.pots.length >= 2, "unequal all-in contributions should create a side pot");

const finiteRoom = defaultRoom({ seats: 4, autoRebuy: true, buyInLimit: 2, sb: 0.5, bb: 1, startStack: 100 });
const finite = createSession(["uncleho", "nitlee"], "selftest", { room: finiteRoom });
finite.stacks = { hero: 10000, uncleho: 0, nitlee: 0 };
finite.buyIns = { hero: 1, uncleho: 1, nitlee: 1 };
assert(canContinueSession(finite).ok, "surviving hero plus available opponent rebuys should keep the session alive");
const rebought = dealNext(finite);
assert(rebought.players.length === 3, "all eligible seats should rebuy into the next hand");
assert(finite.buyIns?.hero === 1 && finite.buyIns?.uncleho === 2 && finite.buyIns?.nitlee === 2, "finite rebuy usage should increment only for busted seats");
finite.stacks = { hero: 0, uncleho: 0, nitlee: 0 };
const exhausted = canContinueSession(finite);
assert(!exhausted.ok && exhausted.reason === "모든 플레이어가 탈락했습니다.", "all-busted table should end even when rebuys remain");

const noRebuyRoom = defaultRoom({ seats: 4, autoRebuy: false, buyInLimit: 1, sb: 0.5, bb: 1, startStack: 100 });
const remaining = createSession(["uncleho", "nitlee"], "selftest", { room: noRebuyRoom });
remaining.stacks = { hero: 10000, uncleho: 0, nitlee: 10000 };
assert(canContinueSession(remaining).ok, "hero and one funded opponent should continue");
const headsUp = dealNext(remaining);
assert(headsUp.players.map((player) => player.id).join(",") === "hero,nitlee", "eliminated opponent should sit out");
assert(positionFor(headsUp.button, headsUp.button, 2) === "SB", "heads-up button should be the small blind");
remaining.stacks = { hero: 0, uncleho: 0, nitlee: 0 };
assert(!canContinueSession(remaining).ok, "no-rebuy table should stop when everyone is eliminated");

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

console.log(`selftest ok: ${assertions} assertions; fold continuation, uncontested pots, all-in progress, and session elimination/rebuy rules`);
