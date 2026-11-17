import { classifyRow, classifyState, isHybridPalette, labels, parseThreadMention, tellTarget, threadIdFromHref, type Kind, type RowHint, type Seed } from "./classify";
import { clearMarks, dropMark, planMarks, pruneMarks, setMark } from "./authors";
import { defaults, normalizeOptions, optionKeys, type Options } from "./options";
import { answerPreview, isKnownTimelineTail, planAnswerFolding, planTimeline } from "./timeline";

let currentOptions = defaults;
// Keep only identities and disclosure choices across content-script remounts.
const answerChoices = new Map<string, boolean>();
const latestAnswers = new Map<string, string>();
const optionAttribute = (key: string) => "data-hyb-" + key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
const listeners = new Set<(options: Options) => void>();
export function publishOptions(value: unknown) {
  currentOptions = normalizeOptions(value);
  for (const listener of listeners) listener(currentOptions);
}
const ROW = "[data-timeline-row-id]";
const rowAttributes = ["data-hyb-kind", "data-hyb-layer", "data-hyb-state", "data-hyb-final", "data-hyb-current", "data-hyb-quiet", "data-hyb-answer-foldable", "data-hyb-answer-collapsed"];
const glyphs = { running: "●", done: "✓", waiting: "·", error: "✗", unknown: "·" };
const stateLabels = { running: "выполняется", done: "завершено", waiting: "ожидание", error: "ошибка", unknown: "статус не определён" };

export function mountHybrid(doc: Document, signal: AbortSignal) {
  const root = doc.documentElement;
  const win = doc.defaultView!;
  const rows = new Set<HTMLElement>();
  const headers = new Set<HTMLElement>();
  const thoughts = new Set<HTMLElement>();
  const decorations = new Set<HTMLElement>();
  const unread = new Set<HTMLElement>();
  // Empty slots we create for author marks and direction arrows. React fills
  // them with bb's own icons (see app.tsx); this script never draws artwork.
  const slotNodes = new Set<HTMLElement>();
  let active = false;
  let disposed = false;
  let pending = 0;
  let bodyObserver: MutationObserver | undefined;
  const set = (element: Element, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  function removeSlot(node: HTMLElement) {
    dropMark(node); node.remove(); slotNodes.delete(node);
  }
  function clearRows() {
    for (const node of [...slotNodes]) removeSlot(node);
    clearMarks();
    for (const node of decorations) node.remove();
    decorations.clear();
    for (const node of unread) node.removeAttribute("data-hyb-unread");
    unread.clear();
    for (const row of rows) for (const attribute of rowAttributes) row.removeAttribute(attribute);
    for (const header of headers) {
      header.removeAttribute("data-hyb-header");
      for (const node of header.querySelectorAll("[data-hyb-decoration]")) node.remove();
    }
    rows.clear(); headers.clear();
    for (const thought of thoughts) thought.removeAttribute("data-hyb-thought");
    thoughts.clear();
  }
  function applyOptions(options: Options) {
    if (!active) return;
    for (const key of optionKeys) set(root, optionAttribute(key), String(options[key]));
    schedule();
  }
  function answerKey(row: HTMLElement) {
    return win.location.pathname + "\n" + row.getAttribute("data-timeline-row-id");
  }
  function onClick(event: MouseEvent) {
    if (!active || !(event.target instanceof win.Element)) return;
    const toggle = event.target.closest<HTMLElement>("[data-hyb-answer-toggle]");
    const row = toggle?.parentElement;
    if (!row?.matches(ROW) || !row.hasAttribute("data-hyb-answer-foldable")) return;
    // Only our button controls our CSS. Native work disclosures belong to bb.
    answerChoices.set(answerKey(row), row.hasAttribute("data-hyb-answer-collapsed"));
    schedule();
  }
  function answerText(row: HTMLElement) {
    const markdown = row.querySelector<HTMLElement>("[data-markdown-preview]");
    if (markdown) return markdown.textContent ?? "";
    const walker = doc.createTreeWalker(row, win.NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest("[data-hyb-decoration],button")) parts.push(node.textContent ?? "");
    }
    return parts.join(" ");
  }
  function answerToggle(row: HTMLElement) {
    let toggle = row.querySelector<HTMLButtonElement>(":scope > [data-hyb-answer-toggle]");
    if (!toggle) {
      toggle = doc.createElement("button");
      toggle.type = "button";
      toggle.className = "hyb-answer-toggle";
      toggle.setAttribute("data-hyb-answer-toggle", "");
      toggle.setAttribute("data-hyb-decoration", "");
      toggle.setAttribute("data-clipboard-ignore", "");
      const title = doc.createElement("span");
      title.setAttribute("data-hyb-answer-title", "");
      title.textContent = "Ответ";
      const preview = doc.createElement("span");
      preview.setAttribute("data-hyb-answer-preview", "");
      toggle.append(title, doc.createTextNode(" "), preview);
      row.prepend(toggle);
    }
    decorations.add(toggle);
    const preview = toggle.querySelector<HTMLElement>("[data-hyb-answer-preview]")!;
    const text = answerPreview(answerText(row));
    if (preview.textContent !== text) preview.textContent = text;
    const expanded = answerChoices.get(answerKey(row)) === true;
    set(toggle, "aria-expanded", String(expanded));
    if (expanded) row.removeAttribute("data-hyb-answer-collapsed");
    else set(row, "data-hyb-answer-collapsed", "");
    return toggle;
  }
  function decoration(parent: HTMLElement, key: string, text: string) {
    let node = parent.querySelector<HTMLElement>(`:scope > [${key}]`);
    if (!node) {
      node = doc.createElement("div");
      node.setAttribute(key, ""); node.setAttribute("data-hyb-decoration", "");
      node.setAttribute("data-clipboard-ignore", "");
      node.textContent = text;
      parent.prepend(node); decorations.add(node);
    }
    return node;
  }
  function syncTimeline() {
    const desiredDecorations = new Set<HTMLElement>();
    const desiredUnread = new Set<HTMLElement>();
    for (const list of doc.querySelectorAll<HTMLElement>('[data-timeline-row-list="top-level"]')) {
      const timeline = Array.from(list.querySelectorAll<HTMLElement>(ROW));
      const scope = list.closest("[data-thread-window]") ?? doc;
      const submit = scope.querySelector<HTMLElement>('[data-app-composer-role="primary"] [data-promptbox-submit-action]');
      // Verified native stop uses Square. Only a native Send/Submit proves idle;
      // no composer, an interaction prompt, or a virtualized tail is unknown.
      const label = submit?.getAttribute("aria-label") ?? "";
      const idle = /^(Submit|Send|Отправить)(?:\s|$|\()/i.test(label);
      const busy = /^(Stop|Остановить)(?:\s|$|\()/i.test(label);
      const tail = list.querySelector<HTMLElement>("[data-timeline-items]");
      const knownTail = isKnownTimelineTail(Array.from(tail?.children ?? []).map(child => ({
        row: child.matches(ROW) || !!child.querySelector(ROW),
        spacerHeight: child.hasAttribute("data-timeline-window-spacer") ? child.getBoundingClientRect().height : 0,
      })));
      const input = timeline.map(row => ({
        id: row.getAttribute("data-timeline-row-id") ?? "",
        owner: (row.getAttribute("data-timeline-row-id") ?? "").includes(":user-seed:")
          && !!row.querySelector(":scope > [data-message-column]"),
      }));
      const plan = planTimeline(input, idle && knownTail, busy && knownTail);
      // Native row ids begin with the thread id, stable across virtualized rows
      // and distinct for parallel thread windows on the same route.
      const threadId = input.find(row => row.id)?.id.split(":")[0];
      const scopeKey = win.location.pathname + "\n" + threadId;
      const folding = planAnswerFolding(input, plan.final, latestAnswers.get(scopeKey) ?? null, knownTail);
      if (knownTail && threadId && folding.latestFinal) latestAnswers.set(scopeKey, folding.latestFinal);
      timeline.forEach((row, i) => {
        if (plan.current.has(i)) {
          set(row, "data-hyb-current", "");
          desiredDecorations.add(decoration(row, "data-hyb-current-label", "Текущий ответ"));
        } else row.removeAttribute("data-hyb-current");
        const foldable = currentOptions.collapseAnswers && folding.foldable.has(i);
        if (currentOptions.final && plan.final.has(i)) {
          set(row, "data-hyb-final", "");
          if (!foldable) desiredDecorations.add(decoration(row, "data-hyb-answer-label", "Ответ"));
        } else row.removeAttribute("data-hyb-final");
        if (foldable) {
          set(row, "data-hyb-answer-foldable", "");
          desiredDecorations.add(answerToggle(row));
        } else {
          row.removeAttribute("data-hyb-answer-foldable");
          row.removeAttribute("data-hyb-answer-collapsed");
        }
        if (currentOptions.quiet && plan.quiet.has(i)) set(row, "data-hyb-quiet", "");
        else row.removeAttribute("data-hyb-quiet");
      });
      const native = list.querySelector<HTMLElement>('[data-testid="thread-unread-divider"]')
        ?? list.querySelector<HTMLElement>('[data-timeline-window-key^="divider:"]');
      if (native) {
        set(native, "data-hyb-unread", ""); desiredUnread.add(native);
        desiredDecorations.add(decoration(native, "data-hyb-read-marker", "Новое с твоего последнего сообщения"));
      } else if (plan.readFrom !== null) {
        desiredDecorations.add(decoration(timeline[plan.readFrom], "data-hyb-read-marker", "Новое с твоего последнего сообщения"));
      }
    }
    for (const node of decorations) if (!desiredDecorations.has(node)) { node.remove(); decorations.delete(node); }
    for (const node of unread) if (!desiredUnread.has(node)) { node.removeAttribute("data-hyb-unread"); unread.delete(node); }
    for (const node of desiredUnread) unread.add(node);
  }
  function findHeader(row: HTMLElement): HTMLElement | null {
    const disclosure = Array.from(row.querySelectorAll<HTMLElement>("[aria-expanded]"))
      .find(node => node.closest(ROW) === row);
    if (disclosure) return disclosure;
    // Verified fallback: pending command wrapper > plain flex header.
    const candidate = Array.from(row.children).find(node => !node.hasAttribute("data-hyb-decoration"))?.firstElementChild;
    return candidate instanceof win.HTMLElement && candidate.closest(ROW) === row ? candidate : null;
  }
  function nativeText(header: HTMLElement) {
    return Array.from(header.childNodes).filter(node => !(node instanceof win.Element && node.hasAttribute("data-hyb-decoration")))
      .map(node => node instanceof win.HTMLElement ? node.innerText : node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
  }
  // Structure, not wording, tells who wrote a user-seed row (verified in the
  // live DOM): the owner has a message column; "Message from" has a thread
  // mention pill in its header; child-thread system lines have a plain thread
  // link in their header. Unknown non-owner seeds stay native.
  function seedOf(row: HTMLElement, header: HTMLElement | null): { seed: Seed; related: string | null } {
    if (row.querySelector(":scope > [data-message-column]")) return { seed: "owner", related: null };
    if (!header) return { seed: "other", related: null };
    const mention = header.querySelector<HTMLElement>("a[data-prompt-mention]");
    const sender = parseThreadMention(mention?.getAttribute("data-prompt-mention-resource") ?? null);
    if (sender) return { seed: "inbound", related: sender };
    const link = header.querySelector<HTMLAnchorElement>("a[href]");
    const target = threadIdFromHref(link?.getAttribute("href") ?? null);
    return target ? { seed: "child", related: target } : { seed: "other", related: null };
  }
  // bb draws its own outgoing message as a `command:` row headed "Sent to
  // <thread pill>" with the Sent icon (verified live). That form carries no
  // `bb thread tell` text, so the structure is the reliable signal.
  function outgoingOf(header: HTMLElement | null): string | null {
    if (!header?.querySelector('svg[data-icon="Sent"]')) return null;
    const mention = header.querySelector<HTMLElement>("a[data-prompt-mention]");
    return parseThreadMention(mention?.getAttribute("data-prompt-mention-resource") ?? null);
  }
  function slot(host: HTMLElement, key: "agent" | "arrow") {
    let node = host.querySelector<HTMLElement>(`:scope > [data-hyb-slot="${key}"]`);
    if (!node) {
      node = doc.createElement("span");
      node.setAttribute("data-hyb-slot", key);
      node.setAttribute("data-hyb-decoration", "");
      node.setAttribute("data-clipboard-ignore", "");
    }
    slotNodes.add(node);
    return node;
  }
  function dropSlot(host: HTMLElement, key: "agent" | "arrow") {
    const node = host.querySelector<HTMLElement>(`:scope > [data-hyb-slot="${key}"]`);
    if (node) removeSlot(node);
  }
  // Which agent mark and which direction arrow a row carries; planMarks owns
  // the rule. Slots are empty here: bb's own icons are portalled in by app.tsx.
  function syncAuthor(row: HTMLElement, header: HTMLElement | null, kind: Kind, related: string | null) {
    const host = kind === "assistant" ? row : header;
    const first = row.getAttribute("data-timeline-row-id")?.split(":")[0] ?? "";
    const own = /^thr_[a-z0-9]+$/.test(first) ? first : null;
    const plan = planMarks(kind, own, related);
    if (!host) { for (const node of [...slotNodes]) if (node.closest(ROW) === row) removeSlot(node); return; }
    // Direction arrows belong to the block type; marks are the optional part.
    const arrow = plan.arrow ? slot(host, "arrow") : null;
    if (!plan.arrow) dropSlot(host, "arrow");
    const agent = plan.agent && currentOptions.marks ? slot(host, "agent") : null;
    if (!agent) dropSlot(host, "agent");
    // Action rows keep their status glyph first; other blocks start with the arrow.
    let cursor: Element | null = kind === "tell" ? host.querySelector(":scope > [data-hyb-glyph]") : null;
    for (const node of [arrow, agent]) {
      if (!node) continue;
      if (node.parentElement !== host || (cursor && node.previousElementSibling !== cursor)) {
        if (cursor) cursor.after(node); else host.prepend(node);
      }
      cursor = node;
    }
    if (arrow && plan.arrow) {
      set(arrow, "data-hyb-dir", plan.arrow);
      setMark(arrow, { thread: null, icon: "ArrowUpRight" });
    }
    if (agent && plan.agent) {
      set(agent, "data-hyb-agent-for", plan.agent);
      setMark(agent, { thread: plan.agent, icon: null });
    }
  }
  function decorate(row: HTMLElement) {
    const header = findHeader(row);
    const text = header ? nativeText(header) : "";
    const id = row.getAttribute("data-timeline-row-id") ?? "";
    let seed: { seed: RowHint; related: string | null } | null = null;
    if (id.includes(":user-seed:")) seed = seedOf(row, header);
    else if (id.includes(":command:")) {
      const target = outgoingOf(header);
      if (target) seed = { seed: "outgoing", related: target };
    }
    const kind = classifyRow(id, text, seed?.seed);
    if (!kind || row.getAttribute("data-hyb-kind") !== kind) {
      // React may recycle a virtualized row for a different item.
      for (const node of [...slotNodes]) if (node.closest(ROW) === row) removeSlot(node);
      for (const attribute of rowAttributes) row.removeAttribute(attribute);
      for (const owned of row.querySelectorAll<HTMLElement>("[data-hyb-header]")) {
        if (owned.closest(ROW) !== row) continue;
        owned.removeAttribute("data-hyb-header"); headers.delete(owned);
        for (const decoration of owned.querySelectorAll("[data-hyb-decoration]")) decoration.remove();
      }
      rows.delete(row);
      for (const thought of thoughts) if (thought.closest(ROW) === row) {
        thought.removeAttribute("data-hyb-thought"); thoughts.delete(thought);
      }
    }
    if (!kind) return; // Unknown native rows remain intact.
    rows.add(row);
    set(row, "data-hyb-kind", kind);
    const layer = kind === "user" || kind === "assistant" || kind === "inbound" || kind === "child" ? kind : "action";
    set(row, "data-hyb-layer", layer);
    if (kind === "think") for (const thought of row.querySelectorAll<HTMLElement>(".whitespace-pre-wrap")) {
      if (thought.closest(ROW) === row) { set(thought, "data-hyb-thought", ""); thoughts.add(thought); }
    }
    // Non-action blocks: marks right away. Action rows add theirs after the glyph.
    if (layer !== "action") syncAuthor(row, header, kind, seed?.related ?? null);
    if (layer !== "action" || !header) return;
    headers.add(header);
    set(header, "data-hyb-header", "");
    const shining = Array.from(header.querySelectorAll(".animate-shine,.animate-shine-icon")).some(e => e.closest(ROW) === row);
    const state = classifyState(text, kind, shining);
    set(row, "data-hyb-state", state);
    let glyph = header.querySelector<HTMLElement>(":scope > [data-hyb-glyph]");
    if (!glyph) {
      glyph = doc.createElement("span");
      glyph.setAttribute("data-hyb-decoration", "");
      glyph.setAttribute("data-hyb-glyph", "");
      glyph.setAttribute("data-clipboard-ignore", "");
      header.prepend(glyph);
    }
    if (glyph.textContent !== glyphs[state]) glyph.textContent = glyphs[state];
    set(glyph, "aria-label", stateLabels[state]);
    set(glyph, "title", stateLabels[state]);
    let chip = header.querySelector<HTMLElement>(":scope > [data-hyb-chip]");
    if (!chip) {
      chip = doc.createElement("span");
      chip.setAttribute("data-hyb-decoration", "");
      chip.setAttribute("data-hyb-chip", "");
      chip.setAttribute("data-clipboard-ignore", "");
      header.append(chip);
    }
    if (chip.textContent !== labels[kind]) chip.textContent = labels[kind];
    syncAuthor(row, header, kind, kind === "tell" ? (seed?.related ?? tellTarget(text)) : null);
  }
  function scan() {
    pending = 0;
    if (disposed || !active) return;
    // Virtualized rows leave the document. Release references promptly.
    for (const row of rows) if (!row.isConnected) {
      for (const attribute of rowAttributes) row.removeAttribute(attribute);
      rows.delete(row);
    }
    for (const header of headers) if (!header.isConnected) {
      header.removeAttribute("data-hyb-header");
      for (const node of header.querySelectorAll("[data-hyb-decoration]")) node.remove();
      headers.delete(header);
    }
    for (const thought of thoughts) if (!thought.isConnected) {
      thought.removeAttribute("data-hyb-thought"); thoughts.delete(thought);
    }
    for (const node of slotNodes) if (!node.isConnected) { dropMark(node); slotNodes.delete(node); }
    pruneMarks();
    for (const row of doc.querySelectorAll<HTMLElement>(ROW)) decorate(row);
    syncTimeline();
  }
  function schedule() {
    if (!disposed && active && !pending) pending = win.requestAnimationFrame(scan);
  }
  function ownMutation(record: MutationRecord) {
    const node = record.target instanceof win.Element ? record.target : record.target.parentElement;
    if (node?.closest("[data-hyb-decoration]")) return true;
    return record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(n =>
      n instanceof win.Element && n.hasAttribute("data-hyb-decoration"));
  }
  function syncTheme() {
    if (disposed) return;
    const next = isHybridPalette(win.getComputedStyle(root).getPropertyValue("--hyb-palette"));
    if (next === active) return;
    active = next;
    if (active) {
      set(root, "data-hyb-active", "");
      applyOptions(currentOptions);
      bodyObserver = new win.MutationObserver(records => {
        if (records.some(record => {
          if (record.type === "attributes" && record.attributeName === "style"
            && !(record.target instanceof win.Element && record.target.hasAttribute("data-timeline-window-spacer"))) return false;
          return !ownMutation(record);
        })) schedule();
      });
      bodyObserver.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["class", "style", "data-timeline-row-id", "aria-expanded", "aria-label", "data-timeline-window-key",
          "data-timeline-items", "data-timeline-window-spacer"] });
      scan();
    } else {
      bodyObserver?.disconnect(); bodyObserver = undefined;
      if (pending) win.cancelAnimationFrame(pending);
      pending = 0;
      root.removeAttribute("data-hyb-active");
      for (const key of optionKeys) root.removeAttribute(optionAttribute(key));
      clearRows();
    }
  }
  const themeObserver = new win.MutationObserver(syncTheme);
  themeObserver.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "media", "disabled"] });
  const modeObserver = new win.MutationObserver(syncTheme);
  modeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });
  doc.addEventListener("load", syncTheme, true);
  doc.addEventListener("click", onClick, true);
  listeners.add(applyOptions);
  syncTheme();
  function dispose() {
    if (disposed) return;
    disposed = true;
    themeObserver.disconnect(); modeObserver.disconnect(); bodyObserver?.disconnect();
    if (pending) win.cancelAnimationFrame(pending);
    doc.removeEventListener("load", syncTheme, true);
    doc.removeEventListener("click", onClick, true);
    listeners.delete(applyOptions);
    root.removeAttribute("data-hyb-active");
    for (const key of optionKeys) root.removeAttribute(optionAttribute(key));
    clearRows();
    signal.removeEventListener("abort", dispose);
  }
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
  return dispose;
}
