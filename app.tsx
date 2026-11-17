import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp, experimental_Icon as BbIcon, experimental_ProviderIcon as ProviderIcon, experimental_useProviders,
  experimental_useSidebarThreads, useRealtime, useRealtimeConnectionState, useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { defaults, normalizeOptions, type Options } from "./options";
import { mountHybrid, publishOptions } from "./content";
import { markEntries, marksVersion, subscribeMarks } from "./authors";
import "./app.css";
import "./authors.css";

function useOptions() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const version = useRef(0);
  const apply = useCallback((value: unknown) => {
    if (!mounted.current) return;
    ++version.current;
    setOptions(normalizeOptions(value)); setError("");
  }, []);
  const refresh = useCallback(() => {
    const at = ++version.current;
    void rpc.call("getOptions", null).then(value => {
      if (mounted.current && at === version.current) apply(value);
    }).catch(cause => { if (mounted.current) setError(String(cause)); });
  }, [rpc, apply]);
  useEffect(() => { mounted.current = true; refresh(); return () => { mounted.current = false; ++version.current; }; }, [refresh, connection]);
  useRealtime("options", apply);
  return { rpc, options, error, refresh, apply };
}
function OptionsBridge() {
  const { options } = useOptions();
  useEffect(() => { if (options) publishOptions(options); }, [options]);
  return <AuthorMarks />;
}
// Fills the empty slots made by the content script with bb's own artwork:
// the same provider icon the sidebar and the model picker draw, and bb's own
// arrow icon. Archived threads are included so an old sender still has a mark.
function AuthorMarks() {
  useSyncExternalStore(subscribeMarks, marksVersion);
  const threads = experimental_useSidebarThreads({ experimental_lifecycles: ["active", "archived"] });
  const providers = experimental_useProviders();
  const byThread = useMemo(() => new Map(threads.threads.map(thread => [thread.id, thread])), [threads.threads]);
  const byProvider = useMemo(() => new Map(providers.providers.map(provider => [provider.id, provider])), [providers.providers]);
  const entries = markEntries();
  const resolved = entries.map(([node, spec]) => {
    if (spec.icon) return { node, icon: spec.icon, provider: null, label: "" };
    const thread = spec.thread ? byThread.get(spec.thread) : undefined;
    const provider = thread ? byProvider.get(thread.providerId) : undefined;
    return { node, icon: null, provider: provider ?? null, label: provider ? String(provider.displayName ?? provider.id) : "" };
  });
  useEffect(() => {
    // An unresolved thread (not in the list yet) shows no circle instead of a guess.
    for (const item of resolved) {
      if (item.icon || item.provider) item.node.removeAttribute("data-hyb-slot-empty");
      else item.node.setAttribute("data-hyb-slot-empty", "");
      if (item.label) item.node.setAttribute("title", item.label);
    }
  });
  return <>{resolved.map(item => createPortal(
    item.icon
      ? <BbIcon name={item.icon} aria-hidden="true" />
      : item.provider ? <ProviderIcon providerKind="agent" provider={item.provider} aria-label={item.label} /> : null,
    item.node,
  ))}</>;
}
function HybridSettings() {
  const { rpc, options, error, refresh, apply } = useOptions();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(patch: Partial<Options>) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setSaveError(""); setSaved(false);
    try {
      const next = await rpc.call("setOptions", patch);
      if (alive.current) { apply(next); publishOptions(next); setSaved(true); }
    } catch (cause) { if (alive.current) setSaveError(String(cause)); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  const o = options ?? defaults;
  const toggles = [
    ["colorcode", "Цветокод типов"], ["mono", "Мысли агента моноширинным"],
    ["rails", "Рельсы у действий"], ["chips", "Подписи-чипы типов"],
    ["final", "Выделять конечный ответ"], ["quiet", "Приглушать работу завершённых ходов"],
    ["collapseAnswers", "Сворачивать прошлые ответы"], ["marks", "Марки авторов в ленте"],
    ["statuses", "Цветные статусы тредов"],
  ] as const;
  return <div data-hyb-settings="" className="space-y-4 text-sm">
    <p className="text-muted-foreground">Оформление включается вместе с палитрой «Гибрид» в Настройки → Внешний вид. С чужой темой обычный интерфейс bb сохраняется.</p>
    {error && <p role="alert">Не удалось загрузить настройки. <button type="button" onClick={refresh}>Повторить</button></p>}
    <fieldset disabled={!options || saving} className="space-y-3">
      <legend className="sr-only">Оформление ленты</legend>
      <label className="flex items-center justify-between gap-4">Плотность
        <select value={o.density} onChange={e => void save({ density: e.target.value === "compact" ? "compact" : "normal" })} className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground">
          <option value="normal">Обычная</option><option value="compact">Компактная</option>
        </select>
      </label>
      {toggles.map(([key, label]) => <label key={key} className="flex items-center gap-3">
        <input type="checkbox" checked={o[key]} onChange={e => void save({ [key]: e.target.checked })} className="size-4" />{label}
      </label>)}
      <label className="flex items-center gap-3 text-muted-foreground">
        <input type="checkbox" checked={false} disabled className="size-4" />Липкая полоса «Сейчас в работе»
      </label>
      <p className="text-xs text-muted-foreground">Выключена: в проверенной версии bb нет отдельного узла текущей работы. Действия и статусы остаются в родной ленте.</p>
      <button type="button" onClick={() => void save(defaults)} className="rounded-md border border-border bg-secondary px-3 py-1.5">Вернуть настройки по умолчанию</button>
    </fieldset>
    {saveError && <p role="alert" className="text-destructive">Настройки не сохранены: {saveError}</p>}
    <p role="status" className="text-xs text-muted-foreground">{saving ? "Сохранение…" : saved ? "Сохранено. Изменения применены во всех окнах." : "Настройки хранятся в bb и применяются без перезагрузки."}</p>
  </div>;
}
export default definePluginApp(app => {
  app.contentScripts.register({ id: "hybrid-dom", mount: ({ signal }) => mountHybrid(document, signal) });
  app.slots.experimental_appOverlay({ id: "options-bridge", component: OptionsBridge });
  app.slots.settingsSection({ id: "appearance", title: "Оформление «Гибрид»", component: HybridSettings });
});
