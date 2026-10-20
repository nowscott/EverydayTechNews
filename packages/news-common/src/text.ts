/** difflib.SequenceMatcher(None, a, b).ratio(), including autojunk for len(b)>=200. */
export function sequenceRatio(left: string, right: string): number {
  const a = Array.from(left); const b = Array.from(right); const index = new Map<string, number[]>();
  b.forEach((c, i) => { const positions = index.get(c) ?? []; positions.push(i); index.set(c, positions); });
  if (b.length >= 200) for (const [c, positions] of index) if (positions.length > Math.floor(b.length / 100) + 1) index.delete(c);
  function longest(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    let besti = alo; let bestj = blo; let best = 0; let lengths = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of index.get(a[i]) ?? []) {
        if (j < blo) continue; if (j >= bhi) break;
        const k = (lengths.get(j - 1) ?? 0) + 1; next.set(j, k);
        if (k > best) { besti = i - k + 1; bestj = j - k + 1; best = k; }
      }
      lengths = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; best++; }
    while (besti + best < ahi && bestj + best < bhi && a[besti + best] === b[bestj + best]) best++;
    return [besti, bestj, best];
  }
  const queue = [[0, a.length, 0, b.length]]; let matches = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!; const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue; matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return a.length + b.length ? 2 * matches / (a.length + b.length) : 1;
}
