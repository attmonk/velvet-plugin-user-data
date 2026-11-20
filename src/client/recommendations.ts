// Minimal affinity calculator for migrating local history through the plugin.
// The full advanced implementation lives in consuming Velvet apps.
// This provides the contract so the dynamic import in UserDataManager succeeds and basic migration works.

import type { ViewingHistory, UserAffinityScores } from './types';

export function calculateUserAffinityScores(history: ViewingHistory[]): UserAffinityScores {
  const tags = new Map<string, number>();
  const performers = new Map<string, number>();
  const studios = new Map<string, number>();

  for (const item of history) {
    const weight = 1; // simple count-based; richer scoring belongs in host app

    if (item.studio?.id) {
      studios.set(item.studio.id, (studios.get(item.studio.id) ?? 0) + weight);
    }
    for (const p of item.performers ?? []) {
      if (p?.id) performers.set(p.id, (performers.get(p.id) ?? 0) + weight);
    }
    for (const t of item.tags ?? []) {
      if (t?.id) tags.set(t.id, (tags.get(t.id) ?? 0) + weight);
    }
  }

  return { tags, performers, studios };
}

// Re-export the type for convenience
export type { ViewingHistory, UserAffinityScores };
