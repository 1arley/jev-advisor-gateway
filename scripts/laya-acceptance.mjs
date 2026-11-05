import { readFileSync } from "node:fs";

const checklist = readFileSync(new URL("../docs/laya-acceptance.md", import.meta.url), "utf8");
const pending = checklist.split("\n").filter((line) => line.startsWith("- [ ]"));
if (pending.length) {
  console.error(`Laya acceptance incomplete:\n${pending.join("\n")}`);
  process.exitCode = 1;
}
