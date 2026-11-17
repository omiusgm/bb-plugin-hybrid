import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("Every authored structural selector is gated by the active palette", () => {
  for (const name of ["../app.css", "../authors.css"]) {
    const css = readFileSync(new URL(name, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1].trim();
      // At-rules and keyframe stops (0%, 70%, 100%) are not structural selectors.
      if (selector.startsWith("@") || /^[\d.%,\s]+$/.test(selector)) continue;
      for (const part of selector.split(",")) assert.ok(part.trim().startsWith(":root[data-hyb-active]"), name + ": " + part);
    }
  }
});
test("Palettes only declare tokens; none can introduce structure", () => {
  const dir = new URL("../themes/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const css = readFileSync(new URL(file, dir), "utf8");
    const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    assert.equal(blocks.length, 2, file);
    assert.deepEqual(blocks.map(m => m[1].trim()), [":root, .light", ".dark"]);
    for (const [, , declarations] of blocks) for (const declaration of declarations.split(";").map(s => s.trim()).filter(Boolean)) {
      assert.ok(declaration.startsWith("--") || declaration.startsWith("color-scheme:"), declaration);
    }
  }
});
