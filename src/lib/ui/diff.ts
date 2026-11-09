export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Word-level diff (LCS) for showing what an AI rewrite changed. Whitespace is kept with each word. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(?<=\s)/);
  const b = after.split(/(?<=\s)/);
  // Long texts fall back to a whole replacement rather than an O(n·m) table.
  if (a.length * b.length > 400_000) return [{ kind: "removed", text: before }, { kind: "added", text: after }];
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("removed", a[i++]);
    else push("added", b[j++]);
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return out;
}
