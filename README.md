# OBD2 Vehicle Health Advisor

An EDD (Eval-Driven Development) capstone project — an AI-powered OBD2 diagnostic agent built with Next.js 14, GPT-4o, and Phoenix (Arize) tracing.

## Vehicles

| ID | Vehicle | Engine | Banks | Fuel |
|----|---------|--------|-------|------|
| `tundra-2007` | 2007 Toyota Tundra | 5.7L V8 | 2 | MAF |
| `bmw-335i-2009` | 2009 BMW 335i | 3.0L N54 Twin-Turbo | 2 | MAF |
| `honda-fit-2015` | 2015 Honda Fit | 1.5L L15B7 | 1 | MAP |

## Setup

```bash
cp .env.example .env
# fill in OPENAI_API_KEY and Phoenix keys
pnpm install
```

## Run

```bash
pnpm dev          # Next.js dev server → http://localhost:3000
pnpm smoke        # CLI smoke test against Tundra snapshot
```

## Evals

```bash
cd evals
pip install -r requirements.txt
pytest sensor_validity.py urgency_calibration.py diagnosis_accuracy.py -v
```

## Project Structure

```
app/api/chat/route.ts     — POST /api/chat endpoint
app/page.tsx              — Simple diagnostic UI
lib/agent.ts              — Core diagnostic agent (GPT-4o + OTel spans)
lib/preprocessor.ts       — Snapshot validation and normalization
lib/tracer.ts             — Dual Phoenix exporter initialization
lib/vehicles.ts           — Typed vehicle configs
data/reference_dataset.csv — Ground-truth eval dataset
data/snapshots/           — Saved OBD2 snapshot files
evals/                    — pytest eval suite
scripts/smoke_test.ts     — CLI smoke test
```

## Tracing

The agent exports spans to two Phoenix projects simultaneously:
- **Sravan's account** (`PHOENIX_API_KEY_SRAVAN`) → project `EDD-OBD2-Joe`
- **Personal account** (`PHOENIX_API_KEY_PERSONAL`) → project `OBD2-Vehicle-Health-Advisor`

Missing keys are skipped gracefully — the agent still runs without tracing.

## Span Attributes

| Attribute | Value |
|-----------|-------|
| `vehicle.id` | e.g. `tundra-2007` |
| `vehicle.make` | e.g. `Toyota` |
| `vehicle.model` | e.g. `Tundra` |
| `vehicle.year` | e.g. `2007` |
| `scenario` | caller-defined label |
| `student_name` | from `STUDENT_NAME` env var |
