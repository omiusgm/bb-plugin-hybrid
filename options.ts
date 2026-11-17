export const defaults = {
  density: "normal" as "normal" | "compact",
  colorcode: true, mono: true, rails: true, sticky: false, chips: true, final: true, quiet: true, statuses: true, collapseAnswers: false, marks: true,
};
export type Options = typeof defaults;
export const optionKeys = Object.keys(defaults) as (keyof Options)[];
export function normalizeOptions(value: unknown): Options {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    density: v.density === "compact" ? "compact" : "normal",
    colorcode: typeof v.colorcode === "boolean" ? v.colorcode : true,
    mono: typeof v.mono === "boolean" ? v.mono : true,
    rails: typeof v.rails === "boolean" ? v.rails : true,
    // No native current-work strip was found in the verified DOM.
    sticky: false,
    chips: typeof v.chips === "boolean" ? v.chips : true,
    final: typeof v.final === "boolean" ? v.final : true,
    quiet: typeof v.quiet === "boolean" ? v.quiet : true,
    statuses: typeof v.statuses === "boolean" ? v.statuses : true,
    collapseAnswers: typeof v.collapseAnswers === "boolean" ? v.collapseAnswers : false,
    marks: typeof v.marks === "boolean" ? v.marks : true,
  };
}
