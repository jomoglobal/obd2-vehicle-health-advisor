import OpenAI from "openai";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getVehicleById } from "./vehicles";
import { preprocessSnapshot } from "./preprocessor";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tracer = trace.getTracer("obd2-vehicle-health-advisor");

export interface AgentInput {
  vehicleId: string;
  snapshotJson: Record<string, unknown>;
  scenario: string;
}

export interface AgentOutput {
  assessment: string;
  warnings: string[];
  vehicleId: string;
  scenario: string;
}

function buildSystemPrompt(vehicleId: string): string {
  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) {
    throw new Error(`Unknown vehicleId: "${vehicleId}"`);
  }

  const bankInfo =
    vehicle.bankCount === 2
      ? "dual-bank (B1 and B2 fuel trims available)"
      : "single-bank (B1 fuel trims only)";

  const turboInfo = vehicle.turbocharged
    ? "turbocharged — boost pressure and charge pipe integrity are relevant"
    : "naturally aspirated";

  const fuelTypeInfo = vehicle.fuelType === "flex-fuel"
    ? "flex-fuel — ethanol content varies per fill-up; fuel trims, AFR targets, and timing all shift with ethanol %; always consider ethanol content when interpreting trim data"
    : "gasoline";

  const quirksBlock =
    vehicle.knownQuirks.length > 0
      ? `\n\nKnown quirks and caveats for this vehicle:\n${vehicle.knownQuirks.map((q) => `- ${q}`).join("\n")}`
      : "";

  const inaccessibleBlock =
    vehicle.inaccessiblePIDs && vehicle.inaccessiblePIDs.length > 0
      ? `\n\nPIDs known to be inaccessible via generic OBD2 on this vehicle (absence is expected, not a fault):\n${vehicle.inaccessiblePIDs.map((p) => `- ${p}`).join("\n")}`
      : "";

  return `You are an expert OBD2 vehicle health advisor with deep knowledge of automotive diagnostics.

Vehicle under analysis:
- ${vehicle.year} ${vehicle.make} ${vehicle.model}
- Engine: ${vehicle.engine}
- Drivetrain: ${turboInfo}
- Bank configuration: ${bankInfo}
- Fuel metering: ${vehicle.fuelSystem}-based
- Fuel type: ${fuelTypeInfo}
- EGR system present: ${vehicle.hasEGR}${quirksBlock}${inaccessibleBlock}

Your task:
1. Analyze the OBD2 sensor snapshot provided.
2. Identify any readings that fall outside healthy operating ranges.
3. Diagnose likely root causes for abnormal values.
4. Assign an urgency level: CRITICAL / HIGH / MEDIUM / LOW / NORMAL.
5. Recommend specific next steps (e.g., "monitor LTFT over a drive cycle", "inspect for vacuum leaks", "scan for pending DTCs").

Be concise but thorough. Reference specific sensor values by name. Account for any known quirks listed above before drawing conclusions.`;
}

export async function runDiagnosticAgent(input: AgentInput): Promise<AgentOutput> {
  const { vehicleId, snapshotJson, scenario } = input;

  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) {
    throw new Error(`Unknown vehicleId: "${vehicleId}"`);
  }

  const { normalized, warnings } = preprocessSnapshot(snapshotJson);

  const studentName = process.env.STUDENT_NAME ?? "unknown";

  return tracer.startActiveSpan("obd2.diagnostic", async (span) => {
    span.setAttributes({
      "vehicle.id": vehicleId,
      "vehicle.make": vehicle.make,
      "vehicle.model": vehicle.model,
      "vehicle.year": vehicle.year,
      scenario,
      student_name: studentName,
    });

    try {
      const systemPrompt = buildSystemPrompt(vehicleId);

      const userMessage = `OBD2 Snapshot:\n\`\`\`json\n${JSON.stringify(normalized, null, 2)}\n\`\`\`${
        warnings.length > 0
          ? `\n\nPreprocessor warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}`
          : ""
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
      });

      const assessment =
        completion.choices[0]?.message?.content ?? "(no response)";

      span.setStatus({ code: SpanStatusCode.OK });

      return { assessment, warnings, vehicleId, scenario };
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
