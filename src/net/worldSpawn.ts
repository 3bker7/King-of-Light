import { formatWorldCellKey, type WorldPos } from './worldTypes';

const CHEBYSHEV_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function chebyshevOriginDistance(pos: WorldPos): number {
  return Math.max(Math.abs(pos.wx), Math.abs(pos.wy));
}

export function isChebyshevAdjacentToAny(
  pos: WorldPos,
  occupiedSet: ReadonlySet<string>
): boolean {
  for (let i = 0; i < CHEBYSHEV_OFFSETS.length; i++) {
    const nx = pos.wx + CHEBYSHEV_OFFSETS[i][0];
    const ny = pos.wy + CHEBYSHEV_OFFSETS[i][1];
    if (occupiedSet.has(formatWorldCellKey(nx, ny))) {
      return true;
    }
  }
  return false;
}

/**
 * Element 1.2 & Harden 1:
 * Deterministic BFS world spawn from (0, 0).
 * - If the world is empty, returns (0, 0).
 * - Otherwise picks the free cell nearest to (0, 0) in Chebyshev BFS order
 *   that is Chebyshev-adjacent (distance 1) to at least one existing kingdom.
 * - Deterministic tie-break: (wy ASC, wx ASC).
 * - Pure & input-order-invariant: identical for every client computing it.
 */
export function pickSpawnCellBFS(occupied: Iterable<WorldPos>): WorldPos {
  const occupiedList: WorldPos[] = [];
  const occupiedSet = new Set<string>();

  for (const raw of occupied) {
    if (
      !raw ||
      !Number.isFinite(raw.wx) ||
      !Number.isFinite(raw.wy)
    ) {
      continue;
    }
    const wx = Math.trunc(raw.wx);
    const wy = Math.trunc(raw.wy);
    const key = formatWorldCellKey(wx, wy);
    if (!occupiedSet.has(key)) {
      occupiedSet.add(key);
      occupiedList.push({ wx, wy });
    }
  }

  if (occupiedList.length === 0) {
    return { wx: 0, wy: 0 };
  }

  // Collect all unique free cells that are Chebyshev-adjacent (distance 1) to any occupied cell.
  const candidateMap = new Map<string, WorldPos>();
  for (let i = 0; i < occupiedList.length; i++) {
    const base = occupiedList[i];
    for (let d = 0; d < CHEBYSHEV_OFFSETS.length; d++) {
      const wx = base.wx + CHEBYSHEV_OFFSETS[d][0];
      const wy = base.wy + CHEBYSHEV_OFFSETS[d][1];
      const key = formatWorldCellKey(wx, wy);
      if (occupiedSet.has(key) || candidateMap.has(key)) continue;
      candidateMap.set(key, { wx, wy });
    }
  }

  const candidates = Array.from(candidateMap.values());
  if (candidates.length === 0) {
    return { wx: 0, wy: 0 };
  }

  // Exact Chebyshev BFS depth from (0,0) is max(|wx|, |wy|); tie-break strictly by (wy, wx).
  candidates.sort((a, b) => {
    const da = chebyshevOriginDistance(a);
    const db = chebyshevOriginDistance(b);
    if (da !== db) return da - db;
    if (a.wy !== b.wy) return a.wy - b.wy;
    return a.wx - b.wx;
  });

  return candidates[0];
}
