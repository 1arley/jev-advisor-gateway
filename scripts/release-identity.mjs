import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateReleaseIdentity({ tag, packageVersion, manifestVersion, changelog }) {
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Invalid release tag: ${tag ?? ""}`);
  const version = tag.slice(1);
  if (!VERSION_PATTERN.test(version)) throw new Error(`Release tag must use stable semver: ${tag}`);
  if (packageVersion !== version) throw new Error(`${tag} does not match package.json version ${packageVersion}`);
  if (manifestVersion !== version) throw new Error(`${tag} does not match release manifest version ${manifestVersion}`);
  const section = new RegExp(`^## \\[?${version.replaceAll(".", "\\.")}\\]?(?:$|[ (])`);
  if (!changelog.split(/\r?\n/).some((line) => section.test(line))) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }
  return version;
}

export function validateReleaseCandidate({ basePackage, nextPackage, baseManifest, nextManifest, baseConfig, nextConfig }) {
  if (basePackage.version === nextPackage.version) throw new Error("Release version must change");
  const sameExcept = (before, after, key, description) => {
    delete before[key];
    delete after[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`Release PR may only change ${description}`);
    }
  };

  sameExcept(structuredClone(basePackage), structuredClone(nextPackage), "version", "package.json version");
  if (nextManifest["."] !== nextPackage.version) {
    throw new Error("release manifest version must match package.json version");
  }
  sameExcept(baseManifest, nextManifest, ".", "the release manifest version");
  if (JSON.stringify(baseConfig) !== JSON.stringify(nextConfig)) {
    if (baseConfig["last-release-sha"] !== "964570800ae1dacca9a1530a72fa711f0e1a1381") {
      throw new Error("Release PR cannot change release-please-config.json");
    }
    delete baseConfig["last-release-sha"];
    if (JSON.stringify(baseConfig) !== JSON.stringify(nextConfig)) {
      throw new Error("Recovery PR may only remove last-release-sha");
    }
  }
}

if (process.argv[1]?.endsWith("release-identity.mjs")) {
  const root = resolve(process.argv[3] ?? ".");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(resolve(root, ".release-please-manifest.json"), "utf8"));
  const version = validateReleaseIdentity({
    tag: process.argv[2] ?? `v${packageJson.version}`,
    packageVersion: packageJson.version,
    manifestVersion: manifest["."],
    changelog: readFileSync(resolve(root, "CHANGELOG.md"), "utf8"),
  });
  console.log(`Release identity is consistent: v${version}`);
}
