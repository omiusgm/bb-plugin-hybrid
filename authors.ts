// Registry of author-mark slots. The content script creates empty slots inside
// timeline rows; the React overlay fills them with bb's own provider icon and
// bb's own arrow icons (portals). Nothing here draws artwork.
export interface MarkSpec {
  /** Thread whose agent provider is shown, or null for a plain icon slot. */
  thread: string | null;
  /** bb icon name (`experimental_Icon`) for arrow slots. */
  icon: string | null;
}
const slots = new Map<HTMLElement, MarkSpec>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version += 1; for (const listener of listeners) listener(); };

export function setMark(node: HTMLElement, spec: MarkSpec) {
  const current = slots.get(node);
  if (current && current.thread === spec.thread && current.icon === spec.icon) return;
  slots.set(node, spec);
  notify();
}
export function dropMark(node: HTMLElement) {
  if (slots.delete(node)) notify();
}
// Virtualized rows leave the document; their slots must not leak or render.
export function pruneMarks() {
  let changed = false;
  for (const node of slots.keys()) if (!node.isConnected) { slots.delete(node); changed = true; }
  if (changed) notify();
}
export function clearMarks() {
  if (slots.size) { slots.clear(); notify(); }
}
export function subscribeMarks(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const marksVersion = () => version;
export const markEntries = (): [HTMLElement, MarkSpec][] => [...slots.entries()];

// Pure: which marks a row of each kind carries. Kept apart from the DOM so the
// "who sees which mark" rule is testable and the same for every code path.
export type MarkPlan = { agent: string | null; arrow: "in" | "out" | null };
export function planMarks(
  kind: string,
  ownThread: string | null,
  related: string | null,
): MarkPlan {
  switch (kind) {
    case "assistant": return { agent: ownThread, arrow: null };
    case "inbound": return { agent: related, arrow: "in" };
    case "tell": return { agent: related, arrow: "out" };
    case "child": return { agent: related, arrow: null };
    default: return { agent: null, arrow: null };
  }
}
