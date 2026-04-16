"""
Synthetic evaluation runner for OBD2 Vehicle Health Advisor.

Loads data/synthetic_reference_dataset.json, runs each case through the
OpenAI chat API using a configurable system prompt, scores the output
against expected_behavior criteria using an LLM-as-judge, logs traces to
Phoenix via OpenTelemetry, saves per-case results to evals/results/, and
prints a summary table.

Usage:
    # Default: uses prompts/system_prompt_v2.txt
    python evals/run_synthetic_evals.py

    # Compare a specific prompt version
    python evals/run_synthetic_evals.py --prompt prompts/system_prompt_v1.txt

    # Filter by scenario tag
    python evals/run_synthetic_evals.py --scenario diagnosis_accuracy

    # Dry run (skip OpenAI calls, use mock responses)
    python evals/run_synthetic_evals.py --dry-run
"""

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

# ── Ensure repo root is on sys.path ───────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# ── Load .env before any other imports ────────────────────────────────────────
from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

# ── OpenAI ────────────────────────────────────────────────────────────────────
from openai import OpenAI  # noqa: E402

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# ── OpenTelemetry tracing ──────────────────────────────────────────────────────
from opentelemetry import trace  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider, SpanProcessor, ReadableSpan  # noqa: E402
from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: E402
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: E402
    OTLPSpanExporter,
)
from opentelemetry.sdk.resources import Resource  # noqa: E402
from opentelemetry.context import Context  # noqa: E402

# ---------------------------------------------------------------------------
# Tracing setup — mirrors lib/tracer.ts dual-provider pattern
# ---------------------------------------------------------------------------

OTEL_PROJECT_KEY = "openinference.project.name"

# Module-level handle on the personal BatchSpanProcessor so run_evals
# can flush it independently of the globally registered Sravan provider.
_personal_batch: BatchSpanProcessor | None = None


def _url(endpoint: str) -> str:
    return endpoint if endpoint.endswith("/v1/traces") else f"{endpoint.rstrip('/')}/v1/traces"


def _setup_tracing(sravan_project: str, personal_project: str) -> trace.Tracer:
    """
    Mirrors lib/tracer.ts exactly:
      - Sravan provider registered as the global OTel provider.
      - Personal BatchSpanProcessor attached via a forwarding SpanProcessor
        on the Sravan provider, so every span reaches both accounts.
    """
    global _personal_batch

    sravan_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT_SRAVAN", "")
    sravan_key      = os.getenv("PHOENIX_API_KEY_SRAVAN", "")
    personal_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT_PERSONAL", "")
    personal_key      = os.getenv("PHOENIX_API_KEY_PERSONAL", "")

    # ── Sravan provider (registered globally) ─────────────────────────────
    sravan_resource = Resource.create({
        "service.name": "obd2-vehicle-health-advisor-evals",
        OTEL_PROJECT_KEY: sravan_project,
    })
    sravan_provider = TracerProvider(resource=sravan_resource)

    if sravan_endpoint and sravan_key:
        sravan_exporter = OTLPSpanExporter(
            endpoint=_url(sravan_endpoint),
            headers={"Authorization": f"Bearer {sravan_key}"},
        )
        sravan_provider.add_span_processor(BatchSpanProcessor(sravan_exporter))
        print(f"✅ [tracer][sravan]   → {_url(sravan_endpoint)} | project: {sravan_project}")
    else:
        print("[tracer][sravan] Skipped — missing endpoint or API key", file=sys.stderr)

    # ── Personal forwarder (not registered globally) ───────────────────────
    _personal_batch = None
    if personal_endpoint and personal_key:
        personal_exporter = OTLPSpanExporter(
            endpoint=_url(personal_endpoint),
            headers={"Authorization": f"Bearer {personal_key}"},
        )
        _personal_batch = BatchSpanProcessor(personal_exporter)
        personal_batch_ref = _personal_batch  # capture for closure

        class _PersonalForwarder(SpanProcessor):
            """Forwards every span from the Sravan provider to the personal exporter."""
            def on_start(self, span: ReadableSpan, parent_context: Context | None = None) -> None:
                pass
            def on_end(self, span: ReadableSpan) -> None:
                personal_batch_ref.on_end(span)
            def shutdown(self) -> None:
                personal_batch_ref.shutdown()
            def force_flush(self, timeout_millis: int = 30_000) -> bool:
                return personal_batch_ref.force_flush(timeout_millis)

        sravan_provider.add_span_processor(_PersonalForwarder())
        print(f"✅ [tracer][personal] → {_url(personal_endpoint)} | project: {personal_project}")
    else:
        print("[tracer][personal] Skipped — missing endpoint or API key", file=sys.stderr)

    trace.set_tracer_provider(sravan_provider)
    return trace.get_tracer("obd2-evals")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATASET_PATH = REPO_ROOT / "data" / "synthetic_reference_dataset.json"
RESULTS_DIR = REPO_ROOT / "evals" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_PROMPT_PATH = REPO_ROOT / "prompts" / "system_prompt_v2.txt"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

URGENCY_LEVELS = ["NORMAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def load_dataset(path: Path) -> list[dict[str, Any]]:
    with open(path) as f:
        return json.load(f)


def load_prompt(path: Path) -> str:
    with open(path) as f:
        return f.read().strip()


def format_snapshot_message(case: dict[str, Any]) -> str:
    """Build the user message from a dataset case."""
    lines = [
        f"Vehicle: {case['context']['vehicle']}",
        f"Engine: {case['context']['engine']}",
        "",
        "OBD2 Snapshot (last/min/max/mean/std per PID):",
        "```json",
        json.dumps(case["input"], indent=2),
        "```",
    ]
    return "\n".join(lines)


def call_diagnostic_agent(
    system_prompt: str,
    user_message: str,
    model: str = "gpt-4o",
    dry_run: bool = False,
) -> str:
    """Call the OpenAI chat completion API and return the assistant response."""
    if dry_run:
        return "[DRY RUN] No actual API call made."

    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.2,
    )
    return completion.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# LLM-as-Judge scorer
# ---------------------------------------------------------------------------

JUDGE_SYSTEM = """\
You are an automotive diagnostics expert evaluating an AI vehicle health advisor.
You will be given:
1. A reference case with expected_behavior (what a good diagnosis should cover).
2. The agent's actual response.

Score the response on these criteria. For each, output a score of 0, 1, or 2:

- urgency_correct (0–2): Is the urgency level appropriate?
  2 = exact match or one-tier off in the conservative direction
  1 = one tier off in either direction
  0 = two or more tiers off, or urgency not mentioned

- root_cause_identified (0–2): Did the agent identify the primary root cause?
  2 = root cause clearly identified and matches expected
  1 = partial / vague diagnosis that hints at root cause
  0 = wrong diagnosis or no specific root cause given

- bogus_value_handled (0–2): If a bogus/stuck sensor was present, was it caught?
  2 = explicitly called out as unreliable and not used as basis for diagnosis
  1 = mentioned as unusual but still used in diagnosis
  0 = taken at face value (or N/A if no bogus value in this case — score 2)

- data_gap_noted (0–2): If expected PIDs were missing, was the gap flagged?
  2 = missing PIDs explicitly noted with impact on confidence
  1 = partially noted
  0 = not mentioned (or N/A if no missing PIDs — score 2)

- vehicle_quirk_cited (0–2): If a known vehicle quirk is relevant, was it cited?
  2 = relevant quirk explicitly referenced
  1 = general awareness shown without naming the quirk
  0 = quirk not mentioned when clearly relevant (or N/A — score 2)

Respond ONLY with a JSON object, no markdown:
{
  "urgency_correct": <0|1|2>,
  "root_cause_identified": <0|1|2>,
  "bogus_value_handled": <0|1|2>,
  "data_gap_noted": <0|1|2>,
  "vehicle_quirk_cited": <0|1|2>,
  "total": <sum>,
  "judge_notes": "<one sentence summary>"
}
"""


def judge_response(
    case: dict[str, Any],
    agent_response: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Use GPT-4o as a judge to score the agent response."""
    if dry_run:
        return {
            "urgency_correct": 2,
            "root_cause_identified": 2,
            "bogus_value_handled": 2,
            "data_gap_noted": 2,
            "vehicle_quirk_cited": 2,
            "total": 10,
            "judge_notes": "DRY RUN — no actual scoring",
        }

    judge_user = f"""
Case ID: {case['case_id']}
Scenario tag: {case['scenario_tag']}
Expected behavior: {case['expected_behavior']}
Failure mode to watch for: {case['failure_mode']}

Agent response:
{agent_response}
""".strip()

    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": judge_user},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    raw = completion.choices[0].message.content or "{}"
    try:
        scores = json.loads(raw)
    except json.JSONDecodeError:
        scores = {
            "urgency_correct": 0,
            "root_cause_identified": 0,
            "bogus_value_handled": 2,
            "data_gap_noted": 2,
            "vehicle_quirk_cited": 0,
            "total": 4,
            "judge_notes": f"JSON parse error from judge: {raw[:200]}",
        }

    # Ensure total is computed correctly
    score_keys = [
        "urgency_correct",
        "root_cause_identified",
        "bogus_value_handled",
        "data_gap_noted",
        "vehicle_quirk_cited",
    ]
    scores["total"] = sum(scores.get(k, 0) for k in score_keys)
    return scores


# ---------------------------------------------------------------------------
# Main eval loop
# ---------------------------------------------------------------------------

PASS_THRESHOLD = 7  # out of 10


def run_evals(
    prompt_path: Path,
    scenario_filter: str | None,
    dry_run: bool,
    model: str,
    sravan_project: str,
    personal_project: str,
) -> None:
    tracer = _setup_tracing(sravan_project, personal_project)
    system_prompt = load_prompt(prompt_path)
    dataset = load_dataset(DATASET_PATH)

    if scenario_filter:
        dataset = [c for c in dataset if c["scenario_tag"] == scenario_filter]
        if not dataset:
            print(f"No cases found for scenario_tag='{scenario_filter}'")
            return

    prompt_label = prompt_path.stem  # e.g. "system_prompt_v2"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"{prompt_label}_{timestamp}"

    results: list[dict[str, Any]] = []

    print(f"\n{'='*70}")
    print(f"  Eval run: {run_id}")
    print(f"  Prompt:   {prompt_path}")
    print(f"  Cases:    {len(dataset)}")
    print(f"  Model:    {model}")
    print(f"  Dry run:  {dry_run}")
    print(f"{'='*70}\n")

    for i, case in enumerate(dataset, 1):
        case_id = case["case_id"]
        scenario_tag = case["scenario_tag"]
        print(f"[{i:02d}/{len(dataset):02d}] {case_id} ({scenario_tag}) ... ", end="", flush=True)

        user_message = format_snapshot_message(case)
        agent_response = ""
        scores: dict[str, Any] = {}
        error: str | None = None

        with tracer.start_as_current_span(f"eval.case.{case_id}") as span:
            span.set_attribute("eval.case_id", case_id)
            span.set_attribute("eval.scenario_tag", scenario_tag)
            span.set_attribute("eval.vehicle_id", case["vehicle_id"])
            span.set_attribute("eval.prompt_label", prompt_label)
            span.set_attribute("eval.run_id", run_id)

            try:
                # Run the diagnostic agent
                with tracer.start_as_current_span("agent.call") as agent_span:
                    agent_span.set_attribute("llm.model", model)
                    agent_response = call_diagnostic_agent(
                        system_prompt, user_message, model=model, dry_run=dry_run
                    )
                    agent_span.set_attribute(
                        "llm.response_length", len(agent_response)
                    )

                # Score the response
                with tracer.start_as_current_span("judge.call") as judge_span:
                    scores = judge_response(case, agent_response, dry_run=dry_run)
                    judge_span.set_attribute("eval.total_score", scores.get("total", 0))

                # Log scores as span attributes
                for k, v in scores.items():
                    if isinstance(v, (int, float)):
                        span.set_attribute(f"eval.score.{k}", v)

                passed = scores.get("total", 0) >= PASS_THRESHOLD
                span.set_attribute("eval.passed", passed)

                status = "PASS" if passed else "FAIL"
                total = scores.get("total", 0)
                print(f"{status} ({total}/10)  — {scores.get('judge_notes', '')}")

            except Exception as exc:
                error = traceback.format_exc()
                span.record_exception(exc)
                span.set_attribute("eval.error", str(exc))
                print(f"ERROR — {exc}")

            result = {
                "run_id": run_id,
                "case_id": case_id,
                "vehicle_id": case["vehicle_id"],
                "scenario_tag": scenario_tag,
                "prompt_label": prompt_label,
                "agent_response": agent_response,
                "scores": scores,
                "passed": scores.get("total", 0) >= PASS_THRESHOLD if scores else False,
                "error": error,
            }
            results.append(result)

        # Gentle rate-limit buffer between cases
        if not dry_run and i < len(dataset):
            time.sleep(0.5)

    # ── Save results ──────────────────────────────────────────────────────────
    results_path = RESULTS_DIR / f"{run_id}.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: {results_path}")

    # ── Summary table ─────────────────────────────────────────────────────────
    passed = [r for r in results if r["passed"]]
    failed = [r for r in results if not r["passed"] and not r["error"]]
    errors = [r for r in results if r["error"]]

    print(f"\n{'='*70}")
    print(f"  SUMMARY  —  {run_id}")
    print(f"{'='*70}")
    print(f"  Total cases:  {len(results)}")
    print(f"  PASS:         {len(passed)}  ({100*len(passed)//max(len(results),1)}%)")
    print(f"  FAIL:         {len(failed)}")
    print(f"  ERROR:        {len(errors)}")

    # Per-scenario breakdown
    tags = sorted({r["scenario_tag"] for r in results})
    if len(tags) > 1:
        print(f"\n  By scenario tag:")
        for tag in tags:
            tag_results = [r for r in results if r["scenario_tag"] == tag]
            tag_pass = sum(1 for r in tag_results if r["passed"])
            print(f"    {tag:<30}  {tag_pass}/{len(tag_results)}")

    # Score distribution
    totals = [r["scores"].get("total", 0) for r in results if r["scores"]]
    if totals:
        avg_score = sum(totals) / len(totals)
        print(f"\n  Avg score:    {avg_score:.1f}/10  (pass threshold: {PASS_THRESHOLD}/10)")

    # Per-criterion averages
    criteria = [
        "urgency_correct",
        "root_cause_identified",
        "bogus_value_handled",
        "data_gap_noted",
        "vehicle_quirk_cited",
    ]
    scored = [r for r in results if r["scores"]]
    if scored:
        print(f"\n  Per-criterion averages (max 2.0 each):")
        for criterion in criteria:
            vals = [r["scores"].get(criterion, 0) for r in scored]
            avg = sum(vals) / len(vals)
            bar = "█" * round(avg * 5)
            print(f"    {criterion:<30}  {avg:.2f}  {bar}")

    # Failures
    if failed:
        print(f"\n  Failed cases:")
        for r in failed:
            total = r["scores"].get("total", 0)
            note = r["scores"].get("judge_notes", "")
            print(f"    {r['case_id']:<15}  {total}/10  {note}")

    print(f"{'='*70}\n")

    # Flush OTel spans — flush both providers so no spans are dropped
    provider = trace.get_tracer_provider()
    if hasattr(provider, "force_flush"):
        provider.force_flush()  # type: ignore[attr-defined]
    if _personal_batch is not None:
        _personal_batch.force_flush()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run synthetic evals for OBD2 Vehicle Health Advisor."
    )
    parser.add_argument(
        "--prompt",
        type=Path,
        default=DEFAULT_PROMPT_PATH,
        help="Path to system prompt file (default: prompts/system_prompt_v2.txt)",
    )
    parser.add_argument(
        "--scenario",
        type=str,
        default=None,
        choices=["diagnosis_accuracy", "urgency_calibration", "data_completeness"],
        help="Filter cases by scenario tag",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="gpt-4o",
        help="OpenAI model to use for the diagnostic agent (default: gpt-4o)",
    )
    parser.add_argument(
        "--sravan-project",
        type=str,
        default=os.getenv("PHOENIX_PROJECT_NAME_SRAVAN", "EDD-OBD2-Joe"),
        help="Phoenix project name for Sravan's account (default: EDD-OBD2-Joe)",
    )
    parser.add_argument(
        "--personal-project",
        type=str,
        default=os.getenv("PHOENIX_PROJECT_NAME_PERSONAL", "OBD2-Vehicle-Health-Advisor"),
        help="Phoenix project name for personal account (default: OBD2-Vehicle-Health-Advisor)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip OpenAI calls; use mock responses for local testing",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_evals(
        prompt_path=args.prompt,
        scenario_filter=args.scenario,
        dry_run=args.dry_run,
        model=args.model,
        sravan_project=args.sravan_project,
        personal_project=args.personal_project,
    )
