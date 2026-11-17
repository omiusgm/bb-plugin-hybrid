import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { defaults, normalizeOptions } from "./options";

const optionsSchema = z.object({
  density: z.enum(["normal", "compact"]),
  colorcode: z.boolean(), mono: z.boolean(), rails: z.boolean(),
  sticky: z.boolean(), chips: z.boolean(),
  final: z.boolean(), quiet: z.boolean(), statuses: z.boolean(), collapseAnswers: z.boolean(), marks: z.boolean(),
});
export const rpcContract = defineRpcContract({
  getOptions: { input: z.null(), output: optionsSchema },
  setOptions: { input: optionsSchema.partial().strict(), output: optionsSchema },
});
export default function register(bb: BbPluginApi) {
  async function read() {
    return normalizeOptions(await bb.storage.kv.get<unknown>("options"));
  }
  let writes: Promise<unknown> = Promise.resolve();
  bb.rpc.register(rpcContract, {
    getOptions: read,
    setOptions(input) {
      const next = writes.then(async () => {
        const options = normalizeOptions({ ...await read(), ...input });
        await bb.storage.kv.set("options", options);
        bb.realtime.publish("options", options);
        return options;
      });
      writes = next.catch(() => undefined);
      return next;
    },
  });
  bb.cli.register({
    name: "hybrid", summary: "Настройки оформления «Гибрид»",
    commands: [
      { name: "show", summary: "Показать настройки", usage: "bb hybrid show" },
      { name: "reset", summary: "Вернуть настройки по умолчанию", usage: "bb hybrid reset" },
    ],
    async run(argv) {
      if (argv.length === 1 && argv[0] === "show") return { exitCode: 0, stdout: JSON.stringify(await read(), null, 2) };
      if (argv.length === 1 && argv[0] === "reset") {
        const next = writes.then(async () => {
          await bb.storage.kv.set("options", defaults);
          bb.realtime.publish("options", defaults);
        });
        writes = next.catch(() => undefined);
        await next;
        return { exitCode: 0, stdout: "Настройки «Гибрида» сброшены." };
      }
      return { exitCode: argv.length === 0 || argv[0] === "--help" ? 0 : 1, stdout: "bb hybrid show\nbb hybrid reset" };
    },
  });
}
