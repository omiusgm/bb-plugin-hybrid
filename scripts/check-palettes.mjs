import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const names = ['grafit', 'terrakota', 'sosna', 'indigo', 'pergament', 'nuar'];
const events = ['think', 'read', 'edit', 'run', 'net', 'delegate', 'tell', 'task', 'attention', 'error'];
const rgb = hex => hex.match(/[\da-f]{2}/gi).map(x => parseInt(x, 16));
const lum = c => c.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y) + .05) / (Math.min(x,y) + .05); };
let failures = 0;
for (const name of names) {
  const css = readFileSync(join(dir, `${name}.css`), 'utf8');
  const blocks = [...css.matchAll(/(:root, \.light|\.dark)\s*\{([^}]*)\}/g)];
  if (blocks.length !== 2) throw Error(`${name}: missing blocks`);
  for (const [, mode, body] of blocks) {
    const vars = Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    if (vars['--hyb-palette'] !== name) throw Error(`${name}: marker`);
    const canvas = rgb(vars['--canvas']), ink = rgb(vars['--ink']);
    const resolve = (key, seen = new Set()) => {
      if (seen.has(key) || !vars[key]) throw Error(`${name} ${mode}: invalid ${key}`);
      seen.add(key);
      const value = vars[key];
      const ref = value.match(/^var\((--[\w-]+)\)$/);
      return ref ? resolve(ref[1], seen) : value;
    };
    for (const state of ['working', 'waiting', 'review', 'done', 'error']) resolve(`--hyb-state-${state}`);
    for (let i = 0; i < 16; i++) {
      const ratio = contrast(rgb(resolve(`--ansi-${i}`)), rgb(resolve(`--ansi-bg-fg-${i}`)));
      if (ratio < 4.5) { console.error(name, mode, `ansi-bg-fg-${i}`, ratio); failures++; }
    }
    for (const key of ['--card-foreground', '--popover-foreground', '--secondary-foreground', '--accent-foreground']) resolve(key);
    const scheme = mode === '.dark' ? 'dark' : 'light';
    if (!new RegExp(`color-scheme:\\s*${scheme}\\s*;`).test(body)) throw Error(`${name} ${mode}: color-scheme`);
    const primary = contrast(rgb(vars['--primary']), rgb(vars['--primary-foreground']));
    if (primary < 4.5) { console.error(name, mode, 'primary', primary); failures++; }
    {
      // Light: darkest 12% surface. Dark: event text has a 4% card backing.
      const neutral = rgb(vars['--hyb-neutral']);
      const mix = mode.includes('light') ? .12 : .04;
      const raised = canvas.map((x, i) => x * (1-mix) + neutral[i] * mix);
      for (const event of events) {
        const ratio = contrast(rgb(vars[`--hyb-${event}`]), raised);
        if (ratio < 4.5) { console.error(name, mode, event, ratio); failures++; }
      }
    }
    console.log(`${name} ${mode}: primary ${primary.toFixed(2)}:1`);
  }
}
if (failures) process.exitCode = 1;
else console.log('All ANSI backgrounds and event text colors meet 4.5:1.');
