// First-run setup for every jev-<client> launcher: when no key for Jev is configured, ask where to
// reach Jev and for the key, check it with one tiny real call, and save it. Runs once; `--setup`
// runs it again. The pieces are separate functions so the conversation can be tested without a
// terminal.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The provider table the gateway itself uses (src/jev.ts), so the two can never disagree. */
export function loadProviders(root) {
  const file = [join(root, "src/providers.json"), join(root, "dist/providers.json")].find(existsSync);
  if (!file) throw new Error("providers.json is missing from this install");
  return JSON.parse(readFileSync(file, "utf8"));
}

const present = (env, name) => Boolean(env[name]?.trim());

/** Same rule as the gateway: an explicit JEV_PROVIDER, else whichever key is there. */
export function configuredProvider(env, providers) {
  const chosen = env.JEV_PROVIDER?.trim().toLowerCase();
  const id = chosen && providers[chosen] ? chosen : Object.keys(providers).find((name) => present(env, providers[name].keyEnv));
  // A keyless provider counts once it is named: it answers without a key of its own.
  return id && (present(env, providers[id].keyEnv) || providers[id].keyless) ? id : undefined;
}

/** Set `values` in the text of a .env file, replacing lines that exist and keeping everything else. */
export function upsertEnv(text, values) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const at = lines.findIndex((existing) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(existing));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
  }
  return lines.join("\n") + "\n";
}

/** Keys are secrets: the file and its directory are readable by their owner only. */
export function saveEnv(file, values) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, upsertEnv(existsSync(file) ? readFileSync(file, "utf8") : "", values), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** One real question to Jev: the only way to know a key works before an agent depends on it. */
export async function validateKey(provider, key, fetchImpl = fetch) {
  const startedAt = Date.now();
  const ask = (model) =>
    fetchImpl(provider.url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "jev-advisor-gateway" },
      body: JSON.stringify({
        model,
        state: "jev-advisor-gateway setup check",
        questions: { ok: { type: "noul", instructions: "Is this a setup check?" } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  try {
    const response = await ask(provider.model);
    // A paid key check may be billed, so setup asks before it makes that call.
    if (!response.ok && provider.paidModel && (response.status === 404 || response.status === 410)) {
      return { ok: false, freeUnavailable: true, refused: false, reason: `${response.status} free model unavailable` };
    }
    if (response.ok) return { ok: true, ms: Date.now() - startedAt };
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    return { ok: false, refused: response.status === 401 || response.status === 403, reason: `${response.status} ${detail}`.trim() };
  } catch (error) {
    return { ok: false, refused: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The conversation. `io` is { print, ask, askSecret }; `validate` and `save` are injected so a test
 * can play the user. Returns the environment values that were saved, or undefined if the user gave up.
 */
export async function runSetup({ name, providers, envFile, io, validate = validateKey, save = saveEnv }) {
  const ids = Object.keys(providers);
  io.print(`\n${name} needs an API key for Jev, the model that picks the tool.`);
  io.print(`You are asked once. The key is saved to ${envFile}, readable only by you.\n`);
  io.print("Where do you want to reach Jev?");
  ids.forEach((id, index) => io.print(`  ${index + 1}) ${providers[id].label}: ${providers[id].note}`));

  let id;
  while (!id) {
    const answer = (await io.ask(`Choose 1-${ids.length} [1]: `)).trim() || "1";
    id = ids[Number(answer) - 1] ?? ids.find((candidate) => candidate === answer.toLowerCase());
    if (!id) io.print(`Please answer with a number from 1 to ${ids.length}.`);
  }
  let provider = providers[id];
  const keyless = Boolean(provider.keyless);
  if (keyless) io.print(`\n${provider.label} needs no key: it runs on your machine (docs: ${provider.keyUrl}).`);
  else if (provider.keyUrl) io.print(`\nGet a key at ${provider.keyUrl}`);
  else io.print(`\n${provider.label} needs no remote key; what you enter below is only a placeholder.`);

  // A keyless provider runs where the user started it: Enter takes the served default, and a custom
  // one gets JEV_URL. A base URL is completed, because the gateway's JEV_URL is the full endpoint.
  let layaUrl;
  if (keyless) {
    const answer = (await io.ask(`Laya URL [${provider.url}]: `)).trim().replace(/\/+$/, "");
    if (answer) {
      layaUrl = answer.endsWith("/v1/systemone") ? answer : `${answer}/v1/systemone`;
      provider = { ...provider, url: layaUrl };
    }
  }

  let model = provider.model;
  if (provider.askModel) {
    const answered = (await io.ask(`Model your ${provider.label} backend serves [${provider.model}]: `)).trim();
    if (answered) model = answered;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const keyPrompt = provider.keyIgnored ? "Paste anything as the key (input is hidden; it is ignored): " : `Paste your ${provider.label} API key (input is hidden): `;
    let key = keyless ? "" : (await io.askSecret(keyPrompt)).trim();
    if (!key && !keyless) {
      io.print("Nothing entered. Run this again whenever you have a key.");
      return undefined;
    }
    io.print(keyless ? "Checking that Laya answers…" : "Checking the key with Jev…");
    let result = await validate({ ...provider, model }, key);
    if (keyless && result.refused) {
      // The serve was started with LAYA_API_KEY, so it wants the bearer key this wizard never asked for.
      key = (await io.askSecret(`laya-serve asks for a bearer key (it was started with LAYA_API_KEY). Paste it (input is hidden): `)).trim();
      io.print("Checking that Laya answers…");
      result = await validate({ ...provider, model }, key);
    }
    if (result.freeUnavailable && provider.paidModel) {
      const paid = (await io.ask(`Use paid ${provider.paidModel} for Jev? Its key check may be billed. [y/N]: `)).trim().toLowerCase();
      if (paid === "y" || paid === "yes") {
        model = provider.paidModel;
        result = await validate({ ...provider, model, paidModel: undefined }, key);
        if (result.ok) result = { ...result, paidModel: model };
      } else {
        io.print("The gateway will pass requests to the LLM while the free Jev model is unavailable.");
      }
    }
    if (!result.ok && result.refused) {
      io.print(`${provider.label} refused that key (${result.reason}).${attempt < 3 ? " Try again, or press Enter to stop." : ""}`);
      continue;
    }
    if (!result.ok) {
      io.print(keyless
        ? `Laya did not answer: ${result.reason}. Start it with: pip install "laya[serve]" && laya-serve`
        : `Could not check the key: ${result.reason}`);
      const keep = (await io.ask("Save it anyway? [y/N]: ")).trim().toLowerCase();
      if (keep !== "y" && keep !== "yes") return undefined;
    } else if (result.paidModel) {
      io.print(`The key works with paid ${result.paidModel}; the free model is unavailable.`);
    } else {
      io.print(keyless ? `Laya answered in ${result.ms} ms.` : `The key works (Jev answered in ${result.ms} ms).`);
    }
    const values = { JEV_PROVIDER: id };
    if (key) values[provider.keyEnv] = key;
    if (layaUrl) values.JEV_URL = layaUrl;
    if (provider.paidModel || provider.askModel) values.JEV_MODEL = model;
    save(envFile, values);
    io.print(`Saved to ${envFile}. Change it any time with \`${name} --setup\`.\n`);
    return values;
  }
  return undefined;
}

/** Terminal input without dependencies; the key is read without being echoed back. */
export function terminalIo(input = process.stdin, output = process.stdout) {
  const read = (prompt, hidden) =>
    new Promise((resolve, reject) => {
      output.write(prompt);
      let typed = "";
      const raw = hidden && input.isTTY;
      if (raw) input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");
      const finish = (error) => {
        input.off("data", onData);
        if (raw) input.setRawMode(false);
        input.pause();
        if (raw) output.write(typed ? `(${typed.length} characters)\n` : "\n");
        if (error) reject(error);
        else resolve(typed);
      };
      const onData = (chunk) => {
        for (const char of chunk) {
          if (char === "\u0003") return finish(new Error("cancelled")); // Ctrl-C
          if (char === "\r" || char === "\n") return finish();
          if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
          else if (char >= " ") typed += char;
        }
      };
      input.on("data", onData);
    });
  return { print: (line) => output.write(line + "\n"), ask: (prompt) => read(prompt, false), askSecret: (prompt) => read(prompt, true) };
}
