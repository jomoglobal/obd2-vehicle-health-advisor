import { NextRequest, NextResponse } from "next/server";
import { initTracer, forceFlush } from "@/lib/tracer";
import { runDiagnosticAgent } from "@/lib/agent";

// Initialize once at module load time (Next.js caches the module across requests)
initTracer();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { vehicleId, snapshotJson, scenario } = body;

    if (!vehicleId || typeof vehicleId !== "string") {
      return NextResponse.json(
        { error: "vehicleId (string) is required" },
        { status: 400 }
      );
    }

    if (!snapshotJson || typeof snapshotJson !== "object") {
      return NextResponse.json(
        { error: "snapshotJson (object) is required" },
        { status: 400 }
      );
    }

    const result = await runDiagnosticAgent({
      vehicleId,
      snapshotJson,
      scenario: scenario ?? "chat",
    });

    // Flush spans before the response is returned — prevents spans from being
    // lost if the Next.js worker is recycled between requests.
    await forceFlush();

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
