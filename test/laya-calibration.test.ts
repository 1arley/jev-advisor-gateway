import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { fitLayaThreshold, layaThreshold } from "../src/laya-calibration.js";

describe("Laya calibration profiles", () => {
  const profile = {
    version: 1,
    source: "synthetic calibration set",
    checkpoint: "english",
    policy: "native",
    buckets: { "3-5": { threshold: 0.91, samples: 30 } },
  };
  it("uses only a matching checkpoint and option bucket", () => {
    const { layaCalibration } = loadConfig({ JEV_LAYA_CALIBRATION: JSON.stringify(profile) });
    expect(layaThreshold(layaCalibration, "english", "native", 4, 0.7)).toBe(0.91);
    expect(layaThreshold(layaCalibration, "multilingual", "native", 4, 0.7)).toBe(0.7);
    expect(layaThreshold(layaCalibration, "english", "native", 8, 0.7)).toBe(0.7);
  });

  it("uses a matching global threshold when the option bucket has no fitted value", () => {
    const { layaCalibration } = loadConfig({
      JEV_LAYA_CALIBRATION: JSON.stringify({
        ...profile,
        buckets: { default: { threshold: 0.61, samples: 32 }, "3-5": { threshold: 0.91, samples: 30 } },
      }),
    });
    expect(layaThreshold(layaCalibration, "english", "native", 2, 0.7)).toBe(0.61);
    expect(layaThreshold(layaCalibration, "english", "native", 4, 0.7)).toBe(0.91);
  });

  it("fits the lowest threshold meeting the smoothed error target with at least 20 samples", () => {
    const observations = [
      ...Array.from({ length: 12 }, () => ({ confidence: 0.9, correct: true })),
      ...Array.from({ length: 8 }, () => ({ confidence: 0.4, correct: false })),
    ];
    expect(fitLayaThreshold(observations, 0.1)).toEqual({ threshold: 0.9, samples: 20 });
    expect(fitLayaThreshold(observations.slice(1), 0.1)).toBeUndefined();
  });
  it("rejects invalid or insufficient profiles", () => {
    for (const invalid of [
      "{",
      JSON.stringify({ ...profile, version: 2 }),
      JSON.stringify({ ...profile, buckets: { "3-5": { threshold: 1.1, samples: 30 } } }),
      JSON.stringify({ ...profile, buckets: { "3-5": { threshold: 0.9, samples: 2 } } }),
      JSON.stringify({ ...profile, buckets: { default: { threshold: 0.9, samples: 19 } } }),
    ]) {
      expect(() => loadConfig({ JEV_LAYA_CALIBRATION: invalid })).toThrow("JEV_LAYA_CALIBRATION");
    }
  });
});

it("applies a matching profile to routing and leaves other checkpoints on the fallback", async () => {
  const { decide } = await import("../src/decide.js");
  const { fakeJev } = await import("./helpers.js");
  const profile = JSON.stringify({
    version: 1,
    source: "fixture",
    checkpoint: "english",
    policy: "native",
    buckets: { "3-5": { threshold: 0.9, samples: 20 } },
  });
  const input = {
    system: "",
    turns: [{ role: "user", text: "Read" }],
    tools: [
      { name: "read", kind: "function" as const },
      { name: "edit", kind: "function" as const },
    ],
    toolChoice: "auto" as const,
  };
  const ask = fakeJev({ tool: { choice: "tool_0", confidence: 0.8 } }).askJev;
  expect(
    (
      await decide(
        input,
        loadConfig({ JEV_PROVIDER: "laya", JEV_MODEL: "english", JEV_LAYA_ROUTING_POLICY: "native", JEV_LAYA_CALIBRATION: profile }),
        ask,
      )
    ).mode,
  ).toBe("passthrough");
  expect(
    (
      await decide(
        input,
        loadConfig({ JEV_PROVIDER: "laya", JEV_MODEL: "multilingual", JEV_LAYA_ROUTING_POLICY: "native", JEV_LAYA_CALIBRATION: profile }),
        ask,
      )
    ).mode,
  ).toBe("forced");
});

it("does not apply a profile when the server reports another checkpoint", async () => {
  const { decide } = await import("../src/decide.js");
  const { fakeJev } = await import("./helpers.js");
  const config = loadConfig({
    JEV_PROVIDER: "laya",
    JEV_MODEL: "english",
    JEV_LAYA_ROUTING_POLICY: "native",
    JEV_LAYA_CALIBRATION: JSON.stringify({
      version: 1,
      source: "fixture",
      checkpoint: "english",
      policy: "native",
      buckets: { "3-5": { threshold: 0.9, samples: 20 } },
    }),
  });
  const input = {
    system: "",
    turns: [{ role: "user", text: "Read" }],
    tools: [
      { name: "read", kind: "function" as const },
      { name: "edit", kind: "function" as const },
    ],
    toolChoice: "auto" as const,
  };
  const fake = fakeJev({ tool: { choice: "tool_0", confidence: 0.8 } }).askJev;
  const result = await decide(input, config, async (request) => ({ ...(await fake(request)), routing: { model: "different-checkpoint" } }));
  expect(result.mode).toBe("forced");
});
