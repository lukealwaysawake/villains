import { hashSeed } from "./rng";

export function commitHash(value: string): string {
  const a = hashSeed(value).toString(16).padStart(8, "0");
  const b = hashSeed(`reveal:${value}`).toString(16).padStart(8, "0");
  const c = hashSeed(`${a}:${b}`).toString(16).padStart(8, "0");
  return `${a}${b}${c}`;
}

export function mixSeeds(seedServer: string, seedClient: string): string {
  return `${commitHash(`${seedServer}|${seedClient}`)}:${seedServer.slice(0, 6)}:${seedClient.slice(0, 6)}`;
}

export function verifyCommit(seedServer: string, publishedHash: string): boolean {
  return commitHash(seedServer) === publishedHash;
}

export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FairnessRecord {
  seedServer: string;
  seedClient: string;
  seedServerHash: string;
  finalSeed: string;
  revealed: boolean;
}

export function createFairness(seedClient?: string): FairnessRecord {
  const seedServer = randomSeed();
  const client = seedClient && seedClient.trim() ? seedClient.trim() : randomSeed();
  return {
    seedServer,
    seedClient: client,
    seedServerHash: commitHash(seedServer),
    finalSeed: mixSeeds(seedServer, client),
    revealed: false,
  };
}
