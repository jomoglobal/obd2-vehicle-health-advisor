// IMPORTANT: tracer.ts must be imported before openai so the instrumentation
// can patch the OpenAI module at load time.
import { trace, SpanStatusCode, context, type Context } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// Surface OTel-internal errors (failed exports, auth rejections, etc.)
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

// Phoenix routes traces to projects via the openinference.project.name
// *resource attribute* — NOT via HTTP headers.
const OTEL_PROJECT_KEY = "openinference.project.name";

/** Next.js framework span names to drop before they reach Phoenix. */
function isFrameworkSpan(name: string): boolean {
  return (
    name.startsWith("POST ") ||
    name.startsWith("GET ") ||
    name === "start response" ||
    name.startsWith("resolve page") ||
    name.startsWith("executing api route")
  );
}

function makeFilteringProcessor(inner: BatchSpanProcessor): SpanProcessor {
  return {
    onStart(span, parentCtx) { inner.onStart(span, parentCtx); },
    onEnd(span: ReadableSpan) {
      if (!isFrameworkSpan(span.name)) inner.onEnd(span);
    },
    shutdown()   { return inner.shutdown(); },
    forceFlush() { return inner.forceFlush(); },
  };
}

let _sravanProvider:   NodeTracerProvider | null = null;
let _personalProvider: NodeTracerProvider | null = null;
let _initialized = false;

export function initTracer(): void {
  if (_initialized) return;

  const studentName = process.env.STUDENT_NAME || "unknown";

  // ── Sravan's account ───────────────────────────────────────────
  const sravanEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT_SRAVAN;
  const sravanKey      = process.env.PHOENIX_API_KEY_SRAVAN;
  const sravanProject  = process.env.PHOENIX_PROJECT_NAME_SRAVAN || "EDD-OBD2-Joe";

  if (sravanEndpoint && sravanKey) {
    const url = sravanEndpoint.endsWith("/v1/traces")
      ? sravanEndpoint
      : `${sravanEndpoint.replace(/\/$/, "")}/v1/traces`;

    const exporter = new OTLPTraceExporter({
      url,
      headers: { Authorization: `Bearer ${sravanKey}` },
    });

    _sravanProvider = new NodeTracerProvider({
      resource: new Resource({
        "service.name": "obd2-vehicle-health-advisor",
        "student.name": studentName,
        [OTEL_PROJECT_KEY]: sravanProject,
      }),
    });
    _sravanProvider.addSpanProcessor(makeFilteringProcessor(new BatchSpanProcessor(exporter)));
    _sravanProvider.register();   // registers as the global provider

    console.log(`✅ [tracer][sravan]   → ${url} | project: ${sravanProject}`);
  } else {
    console.warn("[tracer][sravan] Skipped — missing endpoint or API key");
  }

  // ── Personal account ───────────────────────────────────────────
  const personalEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT_PERSONAL;
  const personalKey      = process.env.PHOENIX_API_KEY_PERSONAL;
  const personalProject  = process.env.PHOENIX_PROJECT_NAME_PERSONAL || "OBD2-Vehicle-Health-Advisor";

  if (personalEndpoint && personalKey) {
    const url = personalEndpoint.endsWith("/v1/traces")
      ? personalEndpoint
      : `${personalEndpoint.replace(/\/$/, "")}/v1/traces`;

    const exporter = new OTLPTraceExporter({
      url,
      headers: { Authorization: `Bearer ${personalKey}` },
    });

    _personalProvider = new NodeTracerProvider({
      resource: new Resource({
        "service.name": "obd2-vehicle-health-advisor",
        "student.name": studentName,
        [OTEL_PROJECT_KEY]: personalProject,
      }),
    });
    // Personal provider is NOT registered globally — we forward spans to it
    // via a custom processor on the sravan (global) provider.
    _personalProvider.addSpanProcessor(makeFilteringProcessor(new BatchSpanProcessor(exporter)));
    _personalProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

    // Forward every span from the global provider to the personal provider too.
    if (_sravanProvider) {
      const personalInner = _personalProvider;
      const forwarder: SpanProcessor = {
        onStart() {},
        onEnd(span: ReadableSpan) {
          if (isFrameworkSpan(span.name)) return;
          // Re-export into the personal provider's processors
          for (const proc of (personalInner as unknown as { _registeredSpanProcessors?: SpanProcessor[] })._registeredSpanProcessors ?? []) {
            proc.onEnd(span);
          }
        },
        shutdown()   { return personalInner.shutdown(); },
        forceFlush() { return personalInner.forceFlush(); },
      };
      _sravanProvider.addSpanProcessor(forwarder);
    } else {
      // Sravan exporter was skipped — register personal as global instead
      _personalProvider.register();
    }

    console.log(`✅ [tracer][personal] → ${url} | project: ${personalProject}`);
  } else {
    console.warn("[tracer][personal] Skipped — missing endpoint or API key");
  }

  _initialized = true;
}

export async function forceFlush(): Promise<void> {
  await Promise.all([
    _sravanProvider?.forceFlush(),
    _personalProvider?.forceFlush(),
  ]);
}

export async function shutdownTracer(): Promise<void> {
  console.log("[tracer] Shutting down — flushing spans...");
  await Promise.all([
    _sravanProvider?.shutdown(),
    _personalProvider?.shutdown(),
  ]);
  _sravanProvider = null;
  _personalProvider = null;
  _initialized = false;
  console.log("[tracer] Shutdown complete");
}
