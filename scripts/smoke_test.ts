/**
 * Smoke test — runs the agent against a minimal Tundra snapshot
 * and prints the diagnostic assessment.
 *
 * Usage:  pnpm smoke
 */

import "dotenv/config";
// tracer must be imported before agent/openai so the instrumentation
// can patch the OpenAI module at require time.
import { initTracer, shutdownTracer } from "../lib/tracer";
import { runDiagnosticAgent } from "../lib/agent";

const tundraSnapshot = {
  RPM: 750,
  ECT: 195,
  STFT_B1: 1.5,
  LTFT_B1: 4.6,
  STFT_B2: -0.7,
  LTFT_B2: 8.59,
};

async function main() {
  console.log("=== OBD2 Vehicle Health Advisor — Smoke Test ===\n");
  console.log("Vehicle : 2007 Toyota Tundra (tundra-2007)");
  console.log("Scenario: smoke_test");
  console.log("Snapshot:", JSON.stringify(tundraSnapshot, null, 2), "\n");

  initTracer();

  try {
    const result = await runDiagnosticAgent({
      vehicleId: "tundra-2007",
      snapshotJson: tundraSnapshot,
      scenario: "smoke_test",
    });

    if (result.warnings.length > 0) {
      console.log("Preprocessor warnings:");
      result.warnings.forEach((w) => console.warn(" !", w));
      console.log();
    }

    console.log("=== ASSESSMENT ===\n");
    console.log(result.assessment);
  } finally {
    // Give the OTLP exporter time to flush before the process exits.
    // shutdownTracer() calls sdk.shutdown() which flushes all processors.
    console.log("\n[smoke] Waiting for spans to flush...");
    try {
      await shutdownTracer();
    } catch (flushErr) {
      console.warn("[smoke] Flush warning (non-fatal):", (flushErr as Error).message);
    }
    console.log("[smoke] Done.");
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
