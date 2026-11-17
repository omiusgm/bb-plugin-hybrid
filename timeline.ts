// Native ids do not put turn: on command/file rows. Summary ids also carry
// their turn before :work-summary:. Never infer a turn from message text.
export function turnId(id: string): string | null {
  return id.match(/^[^:]+:([^:]+):turn(?::\d+)?$/)?.[1]
    ?? id.match(/(?:\||:)turn:([^|:\s]+)/)?.[1]
    ?? id.match(/^[^:]+:([^:]+):work-summary:/)?.[1] ?? null;
}
export interface TimelineRow { id: string; owner: boolean }
export function planTimeline(input: TimelineRow[], tailIdle: boolean, tailBusy = false) {
  const turns: (string | null)[] = [];
  let contextTurn: string | null = null;
  for (const row of input) {
    if (row.id.includes(":user-seed:")) contextTurn = null;
    contextTurn = turnId(row.id) ?? contextTurn;
    turns.push(contextTurn);
  }
  // A command can precede the first reasoning/message of its turn.
  let next: string | null = null;
  for (let i = input.length - 1; i >= 0; --i) {
    if (input[i].id.includes(":user-seed:")) { next = null; continue; }
    const explicit = turnId(input[i].id);
    if (explicit) next = explicit;
    else if (turns[i] && next && turns[i] !== next) turns[i] = null;
    else if (!turns[i]) turns[i] = next;
  }
  const groups = new Map<string, { last: number; answer: number | null }>();
  turns.forEach((turn, i) => {
    if (!turn) return;
    const group = groups.get(turn) ?? { last: i, answer: null };
    group.last = i;
    if (!input[i].owner && input[i].id.includes("kind:assistant") && !input[i].id.includes(":work-summary:")) group.answer = i;
    groups.set(turn, group);
  });
  const final = new Set<number>();
  const completed = new Set<string>();
  for (const [turn, group] of groups) {
    const laterTurn = turns.slice(group.last + 1).some(t => t !== null && t !== turn);
    if (group.answer !== null && (laterTurn || tailIdle)) {
      final.add(group.answer); completed.add(turn);
    }
  }
  // The newest proven answer stays open, including while a new turn is busy.
  const { foldable } = planAnswerFolding(input, final);
  const current = new Set<number>();
  const tailTurn = turns.at(-1);
  const currentAnswer = tailTurn ? groups.get(tailTurn)?.answer : null;
  if (tailBusy && !tailIdle && tailTurn && !completed.has(tailTurn) && currentAnswer != null) current.add(currentAnswer);
  const quiet = new Set<number>();
  turns.forEach((turn, i) => {
    if (!input[i].owner && turn && completed.has(turn) && /:turn(?::\d+)?$|:work-summary:|:command:|:file-(?:read|edit|change):|:tool:|kind:reasoning|op:reasoning/.test(input[i].id)) quiet.add(i);
  });
  let lastOwner = -1;
  input.forEach((row, i) => { if (row.owner) lastOwner = i; });
  return { final, foldable, current, quiet, readFrom: lastOwner >= 0 && lastOwner + 1 < input.length ? lastOwner + 1 : null };
}

// Count Unicode code points so a preview never cuts an emoji surrogate pair.
export function answerPreview(text: string, limit = 70): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.slice(0, limit).join("") + (chars.length > limit ? "…" : "");
}


// A clipped viewport cannot promote an older answer to the newest answer.
// Only a fully mounted tail can replace a remembered final identity.
export function planAnswerFolding(input: TimelineRow[], final: Set<number>, knownLatest: string | null = null, fullTail = false) {
  const visibleLatest = input[Math.max(-1, ...final)]?.id ?? null;
  const latestFinal = (fullTail ? visibleLatest : null) ?? knownLatest;
  const expandedId = latestFinal ?? visibleLatest;
  const foldable = new Set([...final].filter(index => !input[index].owner && input[index].id !== expandedId));
  return { foldable, latestFinal };
}


// Virtualization may pin the final work row below a gap. A last mounted row
// therefore proves nothing unless every spacer after the first row is empty.
export function isKnownTimelineTail(items: { row: boolean; spacerHeight: number }[]): boolean {
  const firstRow = items.findIndex(item => item.row);
  return firstRow >= 0 && !items.slice(firstRow + 1).some(item => item.spacerHeight > 0);
}
