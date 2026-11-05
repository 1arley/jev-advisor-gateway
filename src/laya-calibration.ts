/** Thresholds fitted on labeled, independent scenarios, scoped to one checkpoint. */
export interface LayaCalibration {
  version: 1;
  source: string;
  checkpoint: string;
  policy: "native" | "noul_refined" | "binary_choice";
  buckets: Partial<Record<"2" | "3-5" | "6-10" | "11+", { threshold: number; samples: number }>>;
}

export function parseLayaCalibration(raw: string): LayaCalibration {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("JEV_LAYA_CALIBRATION must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JEV_LAYA_CALIBRATION profile");
  const profile = value as Record<string, unknown>;
  if (
    profile.version !== 1 ||
    typeof profile.source !== "string" ||
    !profile.source.trim() ||
    typeof profile.checkpoint !== "string" ||
    !profile.checkpoint.trim() ||
    !["native", "noul_refined", "binary_choice"].includes(String(profile.policy)) ||
    !profile.buckets ||
    typeof profile.buckets !== "object" ||
    Array.isArray(profile.buckets)
  )
    throw new Error("Invalid JEV_LAYA_CALIBRATION profile");
  for (const [key, entry] of Object.entries(profile.buckets)) {
    if (!["2", "3-5", "6-10", "11+"].includes(key) || !entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid JEV_LAYA_CALIBRATION bucket");
    const bucket = entry as Record<string, unknown>;
    if (
      typeof bucket.threshold !== "number" ||
      !Number.isFinite(bucket.threshold) ||
      bucket.threshold < 0 ||
      bucket.threshold > 1 ||
      typeof bucket.samples !== "number" ||
      !Number.isSafeInteger(bucket.samples) ||
      bucket.samples < 20
    )
      throw new Error("JEV_LAYA_CALIBRATION buckets require a threshold in [0,1] and at least 20 samples");
  }
  return value as LayaCalibration;
}

export function layaThreshold(
  profile: LayaCalibration | undefined,
  checkpoint: string,
  policy: string,
  options: number,
  fallback: number,
): number {
  const key = options <= 2 ? "2" : options <= 5 ? "3-5" : options <= 10 ? "6-10" : "11+";
  return profile?.checkpoint === checkpoint && profile.policy === policy ? (profile.buckets[key]?.threshold ?? fallback) : fallback;
}
