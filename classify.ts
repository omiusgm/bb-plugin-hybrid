export const palettes = new Set(["grafit", "terrakota", "sosna", "indigo", "pergament", "nuar"]);
export function isHybridPalette(marker: string): boolean { return palettes.has(marker.trim()); }
export type Kind = "summary" | "user" | "inbound" | "child" | "assistant" | "think" | "read" | "edit" | "run" | "net" | "delegate" | "tell" | "task" | "git" | "attention" | "error" | "prepare";
export const labels: Record<Kind, string> = {
  user: "сообщение", inbound: "из другого треда", child: "дочерний тред", assistant: "агент", summary: "действия", think: "размышление",
  read: "чтение", edit: "правка", run: "команда", net: "инструмент",
  delegate: "передал →", tell: "написал в тред", task: "задача", git: "git",
  attention: "внимание", error: "ошибка", prepare: "окружение",
};
export function classifyCommand(text: string): Kind {
  if (text.includes("bb thread spawn")) return "delegate";
  if (text.includes("bb thread tell")) return "tell";
  if (text.includes("bb todo-dock") || text.includes("bb task")) return "task";
  if (text.includes("git ")) return "git";
  return "run";
}
// Who wrote a `user-seed` row. The live DOM tells them apart by structure, not
// by text: the owner's message has a message column, "Message from <thread>"
// carries a thread mention pill, a child-thread system line a plain thread link.
export type Seed = "owner" | "inbound" | "child" | "other";
// A `command:` row that bb itself draws as "Sent to <thread>" (Sent icon plus a
// thread mention pill). No `bb thread tell` text is visible in that form.
export type RowHint = Seed | "outgoing";
export function parseThreadMention(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { kind?: unknown; threadId?: unknown };
    return value.kind === "thread" && typeof value.threadId === "string" && /^thr_[a-z0-9]+$/.test(value.threadId)
      ? value.threadId : null;
  } catch { return null; }
}
export function threadIdFromHref(href: string | null): string | null {
  return href?.match(/\/threads\/(thr_[a-z0-9]+)(?:[/?#]|$)/)?.[1] ?? null;
}
// Heuristic: only a literal id right after `bb thread tell` names the target.
// `$VAR` and other shell expansions are never guessed.
export function tellTarget(text: string): string | null {
  return text.match(/bb thread tell\s+(?:--?[\w-]+(?:[= ](?!thr_)\S+)?\s+)*(thr_[a-z0-9]+)\b/)?.[1] ?? null;
}
export function classifyRow(id: string, text: string, seed?: RowHint): Kind | null {
  // Summary ids contain the first child's id: test summary before child types.
  if (id.includes(":work-summary:") || /^[^:]+:[^:]+:turn(?::\d+)?$/.test(id)) return "summary";
  if (id.includes(":user-seed:")) {
    if (seed === "inbound" || seed === "child") return seed;
    // An unknown non-owner seed is left native instead of posing as the owner.
    return seed === "other" ? null : "user";
  }
  if (id.includes("kind:assistant")) return "assistant";
  if (id.includes("kind:reasoning") || id.includes("op:reasoning")) return "think";
  if (id.includes(":file-read:")) return "read";
  if (id.includes(":file-edit:") || id.includes(":file-change:")) return "edit";
  if (id.includes(":command:")) return seed === "outgoing" ? "tell" : classifyCommand(text);
  if (id.includes(":tool:")) return "net";
  if (id.includes("op:thread-provisioning")) return "prepare";
  if (id.includes("op:warning")) return "attention";
  if (id.includes(":error:")) return "error";
  return null;
}
export type State = "running" | "done" | "waiting" | "error" | "unknown";
export function classifyState(text: string, kind: Kind, shining = false): State {
  if (kind === "error" || /^(Failed|Error|Ошибка|Не удалось)(?=\s|$|[:.,—-])/i.test(text)) return "error";
  if (/^(Queued|Waiting|Ожидает|В очереди)(?=\s|$|[:.,—-])/i.test(text)) return "waiting";
  if (shining || /^(Running|Reading|Editing|Searching|Thinking|Выполняется|Чтение|Думает)(?=\s|$|[:.,—-])/i.test(text)) return "running";
  if (/^(Ran|Read|Edited|Updated|Created|Deleted|Explored|Searched|Called|Completed|Finished|Worked for|Выполнено|Прочитано|Изменено)(?=\s|$|[:.,—-])/i.test(text)) return "done";
  return "unknown";
}
