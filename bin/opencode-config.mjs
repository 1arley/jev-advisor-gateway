import {
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const JSONC_COMMENT = /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const JSONC_TRAILING_COMMA = /"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g;
const keepStrings = (match) => (match.startsWith('"') ? match : "");

export function parseJsonc(text) {
  try {
    return JSON.parse(text.replace(JSONC_COMMENT, keepStrings).replace(JSONC_TRAILING_COMMA, keepStrings));
  } catch {
    return undefined;
  }
}

function configPath(env) {
  const directory = env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode");
  const path = env.OPENCODE_CONFIG ?? [join(directory, "opencode.json"), join(directory, "opencode.jsonc")].find(existsSync);
  if (!path || !existsSync(path)) return undefined;
  return realpathSync(path);
}

function baseURLFields(document) {
  if (!isObject(document)) return [];
  const fields = [];
  for (const [providersKey, optionsKeys] of [
    ["provider", ["options"]],
    ["providers", ["settings"]],
  ]) {
    const providers = document[providersKey];
    if (!isObject(providers)) continue;
    for (const [providerId, provider] of Object.entries(providers)) {
      if (!isObject(provider)) continue;
      for (const optionsKey of optionsKeys) {
        const options = provider[optionsKey];
        if (isObject(options) && typeof options.baseURL === "string") {
          fields.push({ providersKey, providerId, optionsKey, options, baseURL: options.baseURL });
        }
      }
    }
  }
  return fields;
}

function canonical(url) {
  return url.replace(/\/+$/, "");
}

function gatewayBase(upstream, origin) {
  const url = new URL(upstream);
  return `${origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function restoreURL(baseURL, upstream) {
  return canonical(baseURL) === canonical(upstream) ? baseURL : undefined;
}

function writeConfig(path, content, expected) {
  const mode = lstatSync(path).mode & 0o777;
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode });
    if (readFileSync(path, "utf8") !== expected) throw new Error("OpenCode config changed during update");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function replaceBaseURLs(text, updates) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      index = text.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return undefined;
      index = end + 2;
      continue;
    }
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index++] === '"') break;
      }
      const raw = text.slice(start, index);
      try {
        tokens.push({ kind: "string", start, end: index, value: JSON.parse(raw) });
      } catch {
        return undefined;
      }
      continue;
    }
    if ("{}[]:,".includes(char)) {
      tokens.push({ kind: char, start: index, end: index + 1 });
      index++;
      continue;
    }
    const start = index++;
    while (index < text.length && !/[\s{}\[\]:,]/.test(text[index])) index++;
    tokens.push({ kind: "other", start, end: index });
  }

  const replacements = [];
  let cursor = 0;
  function read(path) {
    const token = tokens[cursor++];
    if (!token) return false;
    if (token.kind === "{") {
      while (tokens[cursor]?.kind !== "}") {
        const key = tokens[cursor++];
        if (key?.kind !== "string" || tokens[cursor++]?.kind !== ":" || !read([...path, key.value])) return false;
        if (tokens[cursor]?.kind === ",") cursor++;
        else if (tokens[cursor]?.kind !== "}") return false;
      }
      cursor++;
      return true;
    }
    if (token.kind === "[") {
      let item = 0;
      while (tokens[cursor]?.kind !== "]") {
        if (!read([...path, String(item++)])) return false;
        if (tokens[cursor]?.kind === ",") cursor++;
        else if (tokens[cursor]?.kind !== "]") return false;
      }
      cursor++;
      return true;
    }
    if (token.kind === "string" && path.length === 4) {
      const [providersKey, providerId, optionsKey, field] = path;
      if (
        field === "baseURL" &&
        ((providersKey === "provider" && optionsKey === "options") || (providersKey === "providers" && optionsKey === "settings"))
      ) {
        const key = JSON.stringify(path);
        if (updates.has(key)) replacements.push({ start: token.start, end: token.end, value: JSON.stringify(updates.get(key)) });
      }
    }
    return true;
  }
  if (!read([]) || cursor !== tokens.length || replacements.length !== updates.size) return undefined;
  return replacements.toReversed().reduce((result, item) => result.slice(0, item.start) + item.value + result.slice(item.end), text);
}

const fieldKey = (field) => JSON.stringify([field.providersKey, field.providerId, field.optionsKey, "baseURL"]);

/** Repoint only providers already configured for this launcher's upstream. */
export function repointOpenCodeConfig({ origin, upstream, env = process.env }) {
  const path = configPath(env);
  if (!path) return { changed: false, reason: "config_missing" };
  const backup = `${path}.jev-gateway.bak`;
  const marker = `${path}.jev-gateway.json`;
  const source = readFileSync(path, "utf8");
  let document = parseJsonc(source);
  if (!isObject(document)) return { changed: false, reason: "config_invalid" };
  const target = gatewayBase(upstream, origin);
  let managed;
  if (existsSync(marker)) {
    try {
      managed = JSON.parse(readFileSync(marker, "utf8"));
      if (managed.origin !== origin) {
        return { changed: false, reason: "different_gateway" };
      }
    } catch {
      return { changed: false, reason: "marker_invalid" };
    }
  }
  const fields = baseURLFields(document);
  let matching = fields.flatMap((field) => {
    const saved = managed?.fields?.find((item) => fieldKey(item) === fieldKey(field));
    const restoreTo = field.baseURL === target && saved ? saved.restoreURL : restoreURL(field.baseURL, upstream);
    return restoreTo === undefined ? [] : [{ ...field, restoreTo }];
  });
  if (managed && !existsSync(backup)) {
    if (fields.some((field) => field.baseURL === target)) return { changed: false, reason: "backup_missing" };
    rmSync(marker, { force: true });
    managed = undefined;
  }
  const existingGatewayURLs = fields.filter((field) => field.baseURL === target);
  matching = matching.filter((field) => field.baseURL !== target);
  if (!matching.length && existingGatewayURLs.length) {
    return { changed: false, reason: "already_routed" };
  }
  if (!matching.length) return { changed: false, reason: "provider_not_found" };

  if (managed) {
    const original = parseJsonc(readFileSync(backup, "utf8"));
    if (!isObject(original) || !Array.isArray(managed.fields)) return { changed: false, reason: "marker_invalid" };
    const originalFields = new Map(baseURLFields(original).map((field) => [fieldKey(field), field]));
    const managedFields = new Map(managed.fields.map((field) => [fieldKey(field), field]));
    matching = matching.flatMap((field) => {
      const saved = managedFields.get(fieldKey(field));
      if (saved)
        return field.baseURL === gatewayBase(managed.upstream ?? upstream, origin) ? [{ ...field, restoreTo: saved.restoreURL }] : [];
      const originalField = originalFields.get(fieldKey(field));
      return originalField && restoreURL(originalField.baseURL, upstream) === field.restoreTo
        ? [{ ...field, originalURL: originalField.baseURL }]
        : [];
    });
    if (!matching.length) return { changed: false, reason: "provider_not_managed" };
    managed.fields.push(
      ...matching
        .filter((field) => !managedFields.has(fieldKey(field)))
        .map((field) => ({
          providersKey: field.providersKey,
          providerId: field.providerId,
          optionsKey: field.optionsKey,
          originalURL: field.originalURL,
          restoreURL: field.restoreTo,
        })),
    );
    const temporaryMarker = `${marker}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryMarker, `${JSON.stringify(managed)}\n`, { mode: 0o600 });
      renameSync(temporaryMarker, marker);
    } finally {
      rmSync(temporaryMarker, { force: true });
    }
  }

  if (!managed && existsSync(backup)) return { changed: false, reason: "backup_exists" };
  if (!managed) {
    let backupCreated = false;
    try {
      copyFileSync(path, backup, constants.COPYFILE_EXCL);
      backupCreated = true;
      chmodSync(backup, 0o600);
    } catch {
      return { changed: false, reason: existsSync(backup) ? "backup_exists" : "backup_failed" };
    }
    try {
      writeFileSync(
        marker,
        `${JSON.stringify({
          origin,
          upstream,
          fields: matching.map(({ providersKey, providerId, optionsKey, baseURL, restoreTo }) => ({
            providersKey,
            providerId,
            optionsKey,
            originalURL: baseURL,
            restoreURL: restoreTo,
          })),
        })}\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      if (backupCreated) rmSync(backup, { force: true });
      return { changed: false, reason: "marker_failed" };
    }
  }
  const latest = readFileSync(path, "utf8");
  if (latest !== source) {
    if (!managed) {
      rmSync(marker, { force: true });
      rmSync(backup, { force: true });
    }
    return { changed: false, reason: "config_changed" };
  }
  const updated = replaceBaseURLs(source, new Map(matching.map((field) => [fieldKey(field), target])));
  if (updated === undefined) {
    if (!managed) {
      rmSync(marker, { force: true });
      rmSync(backup, { force: true });
    }
    return { changed: false, reason: "config_update_failed" };
  }
  writeConfig(path, updated, source);
  return { changed: true, providers: matching.map((field) => field.providerId) };
}

/** Restore only values this launcher set, leaving later user edits intact. */
export function restoreOpenCodeConfig({ origin, upstream, env = process.env }) {
  const path = configPath(env);
  if (!path) return { changed: false, reason: "config_missing" };
  const backup = `${path}.jev-gateway.bak`;
  const marker = `${path}.jev-gateway.json`;
  if (!existsSync(backup) && !existsSync(marker)) return { changed: false, reason: "not_managed" };
  if (!existsSync(backup)) return { changed: false, reason: "backup_missing" };
  if (!existsSync(marker)) return { changed: false, reason: "marker_missing" };
  let managed;
  try {
    managed = JSON.parse(readFileSync(marker, "utf8"));
    if (managed.origin !== origin) return { changed: false, reason: "different_gateway" };
  } catch {
    return { changed: false, reason: "marker_invalid" };
  }
  const currentText = readFileSync(path, "utf8");
  const current = parseJsonc(currentText);
  const originalText = readFileSync(backup, "utf8");
  const original = parseJsonc(originalText);
  if (!isObject(current) || !isObject(original)) return { changed: false, reason: "config_invalid" };
  const target = gatewayBase(managed.upstream ?? upstream, origin);
  if (!Array.isArray(managed.fields)) return { changed: false, reason: "marker_invalid" };
  const originalFields = new Map(baseURLFields(original).map((field) => [fieldKey(field), field.baseURL]));
  const currentFields = new Map(
    baseURLFields(current).map((field) => [`${field.providersKey}.${field.providerId}.${field.optionsKey}`, field]),
  );
  const matches = managed.fields.flatMap(({ providersKey, providerId, optionsKey }) => {
    const key = `${providersKey}.${providerId}.${optionsKey}`;
    const field = currentFields.get(key);
    const saved = managed.fields.find((item) => fieldKey(item) === fieldKey({ providersKey, providerId, optionsKey }));
    const originalKey = fieldKey({ providersKey, providerId, optionsKey });
    return field &&
      saved &&
      originalFields.has(originalKey) &&
      originalFields.get(originalKey) === saved.originalURL &&
      field.baseURL === target
      ? [{ ...field, restoreTo: saved.restoreURL }]
      : [];
  });
  if (!matches.length) {
    return {
      changed: false,
      reason: baseURLFields(current).some((field) => field.baseURL === target) ? "no_managed_values" : "user_changed_url",
    };
  }

  const updates = new Map(matches.map((field) => [fieldKey(field), field.restoreTo]));
  const restored = replaceBaseURLs(currentText, updates);
  if (restored === undefined) return { changed: false, reason: "config_update_failed" };
  writeConfig(path, restored, currentText);
  rmSync(marker, { force: true });
  rmSync(backup, { force: true });
  return { changed: true, providers: matches.map((field) => field.providerId) };
}

/** Patch the per-process v1 overlay without adding a model or provider. */
export function repointOpenCodeOverlay(content, { origin, upstream }) {
  if (!content?.trim()) return content;
  const document = parseJsonc(content);
  if (!isObject(document)) return content;
  const target = gatewayBase(upstream, origin);
  let changed = false;
  for (const field of baseURLFields(document)) {
    if (canonical(field.baseURL) !== canonical(upstream)) continue;
    field.options.baseURL = target;
    changed = true;
  }
  return changed ? JSON.stringify(document) : content;
}
