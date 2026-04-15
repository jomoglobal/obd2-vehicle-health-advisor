/**
 * Preprocessor — validates and normalizes raw OBD2 snapshot data
 * before it is passed to the agent.
 */

export interface OBD2Snapshot {
  RPM?: number;
  ECT?: number;       // Engine Coolant Temp (°F)
  IAT?: number;       // Intake Air Temp (°F)
  MAP?: number;       // Manifold Absolute Pressure (kPa)
  MAF?: number;       // Mass Air Flow (g/s)
  THROTTLE?: number;  // Throttle position (%)
  LOAD?: number;      // Calculated engine load (%)
  STFT_B1?: number;   // Short-term fuel trim Bank 1 (%)
  LTFT_B1?: number;   // Long-term fuel trim Bank 1 (%)
  STFT_B2?: number;   // Short-term fuel trim Bank 2 (%)
  LTFT_B2?: number;   // Long-term fuel trim Bank 2 (%)
  O2_B1S1?: number;   // O2 sensor voltage B1S1
  O2_B1S2?: number;   // O2 sensor voltage B1S2
  O2_B2S1?: number;   // O2 sensor voltage B2S1
  O2_B2S2?: number;   // O2 sensor voltage B2S2
  VSS?: number;       // Vehicle speed (mph)
  BOOST?: number;     // Boost pressure (psi) — turbo vehicles
  DTCs?: string[];    // Active diagnostic trouble codes
  [key: string]: unknown;
}

export interface PreprocessorResult {
  normalized: OBD2Snapshot;
  warnings: string[];
}

const SENSOR_RANGES: Record<string, [number, number]> = {
  RPM: [0, 8000],
  ECT: [-40, 300],
  IAT: [-40, 250],
  MAP: [0, 255],
  MAF: [0, 655],
  THROTTLE: [0, 100],
  LOAD: [0, 100],
  STFT_B1: [-25, 25],
  LTFT_B1: [-25, 25],
  STFT_B2: [-25, 25],
  LTFT_B2: [-25, 25],
  O2_B1S1: [0, 1.275],
  O2_B1S2: [0, 1.275],
  O2_B2S1: [0, 1.275],
  O2_B2S2: [0, 1.275],
  VSS: [0, 200],
  BOOST: [-5, 40],
};

export function preprocessSnapshot(raw: Record<string, unknown>): PreprocessorResult {
  const normalized: OBD2Snapshot = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (key === "DTCs") {
      if (Array.isArray(value)) {
        normalized.DTCs = value.map(String);
      } else {
        warnings.push(`DTCs field is not an array — skipped`);
      }
      continue;
    }

    const numVal = typeof value === "string" ? parseFloat(value) : Number(value);

    if (isNaN(numVal)) {
      warnings.push(`Sensor "${key}" has non-numeric value "${value}" — skipped`);
      continue;
    }

    const range = SENSOR_RANGES[key];
    if (range) {
      const [min, max] = range;
      if (numVal < min || numVal > max) {
        warnings.push(
          `Sensor "${key}" value ${numVal} is outside expected range [${min}, ${max}] — included but flagged`
        );
      }
    }

    (normalized as Record<string, unknown>)[key] = numVal;
  }

  return { normalized, warnings };
}
