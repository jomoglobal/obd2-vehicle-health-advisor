/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Next.js NOT to bundle these packages — require them natively.
  // Without this, webpack creates a separate module instance of @opentelemetry/api
  // from the one tracer.ts registers the provider on, so trace.getTracer() in
  // agent.ts gets a no-op provider and spans are never created.
  serverExternalPackages: [
    "@opentelemetry/api",
    "@opentelemetry/context-base",
    "@opentelemetry/core",
    "@opentelemetry/exporter-trace-otlp-proto",
    "@opentelemetry/otlp-exporter-base",
    "@opentelemetry/otlp-transformer",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/semantic-conventions",
    "@arizeai/openinference-instrumentation-openai",
    "@arizeai/openinference-core",
    "@arizeai/openinference-semantic-conventions",
  ],
};

module.exports = nextConfig;
