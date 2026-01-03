import { RelayPool } from "applesauce-relay";

let pool: RelayPool | null = null;

export function getRelayPool(): RelayPool {
  if (!pool) {
    pool = new RelayPool();
  }
  return pool;
}

export function closeRelayPool(): void {
  try {
    // RelayPool may expose a close/stop; call if present
    (pool as unknown as { close?: () => void })?.close?.();
    (pool as unknown as { stop?: () => void })?.stop?.();
  } catch {
    // Ignore cleanup errors
  }
  pool = null;
}
