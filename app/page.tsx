"use client";

import { useState } from "react";
import { vehicles } from "@/lib/vehicles";

interface DiagnosticResult {
  assessment: string;
  warnings: string[];
  vehicleId: string;
  scenario: string;
}

const DEFAULT_SNAPSHOT = JSON.stringify(
  {
    RPM: 750,
    ECT: 195,
    STFT_B1: 1.5,
    LTFT_B1: 4.6,
    STFT_B2: -0.7,
    LTFT_B2: 8.59,
  },
  null,
  2
);

export default function Home() {
  const [vehicleId, setVehicleId] = useState(vehicles[0].id);
  const [snapshotText, setSnapshotText] = useState(DEFAULT_SNAPSHOT);
  const [scenario, setScenario] = useState("idle_diagnostic");
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    let snapshotJson: Record<string, unknown>;
    try {
      snapshotJson = JSON.parse(snapshotText);
    } catch {
      setError("Invalid JSON in snapshot field.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId, snapshotJson, scenario }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem", fontFamily: "monospace" }}>
      <h1>OBD2 Vehicle Health Advisor</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "1rem" }}>
          <label>
            <strong>Vehicle</strong>
            <br />
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.year} {v.make} {v.model} — {v.engine}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>
            <strong>Scenario</strong>
            <br />
            <input
              type="text"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            />
          </label>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label>
            <strong>OBD2 Snapshot (JSON)</strong>
            <br />
            <textarea
              value={snapshotText}
              onChange={(e) => setSnapshotText(e.target.value)}
              rows={12}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", fontFamily: "monospace" }}
            />
          </label>
        </div>

        <button type="submit" disabled={loading} style={{ padding: "0.5rem 1.5rem" }}>
          {loading ? "Analyzing..." : "Run Diagnostic"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: "1rem", color: "red" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Assessment</h2>
          {result.warnings.length > 0 && (
            <div style={{ background: "#fffbe6", padding: "0.75rem", marginBottom: "1rem" }}>
              <strong>Preprocessor Warnings:</strong>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: "1rem" }}>
            {result.assessment}
          </pre>
        </div>
      )}
    </main>
  );
}
