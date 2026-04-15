"""
Eval: Urgency Calibration
--------------------------
Verifies that the agent assigns urgency levels that match clinical expectations:
- Critical/severe conditions (coolant temp, catastrophic fuel trims) → CRITICAL or HIGH
- Mild drift conditions → MEDIUM or LOW
- Healthy baseline → NORMAL or LOW

Scoring: pass/fail per case based on expected urgency tier.
"""

import os
import json
import re
import pytest
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

URGENCY_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NORMAL"]

URGENCY_CASES = [
    {
        "id": "healthy_idle",
        "vehicleId": "tundra-2007",
        "snapshot": {
            "RPM": 750,
            "ECT": 195,
            "STFT_B1": 0.8,
            "LTFT_B1": 1.2,
            "STFT_B2": -0.4,
            "LTFT_B2": 0.9,
        },
        "expected_tier": ["NORMAL", "LOW"],
        "description": "All values within healthy range — expect NORMAL or LOW",
    },
    {
        "id": "mild_lean_drift",
        "vehicleId": "tundra-2007",
        "snapshot": {
            "RPM": 780,
            "ECT": 192,
            "STFT_B1": 3.0,
            "LTFT_B1": 7.5,
            "STFT_B2": 2.1,
            "LTFT_B2": 6.8,
        },
        "expected_tier": ["MEDIUM", "HIGH"],
        "description": "Both banks drifting lean — moderate concern",
    },
    {
        "id": "severe_overheating",
        "vehicleId": "bmw-335i-2009",
        "snapshot": {
            "RPM": 900,
            "ECT": 265,
            "STFT_B1": 0.0,
            "LTFT_B1": 0.0,
        },
        "expected_tier": ["CRITICAL", "HIGH"],
        "description": "ECT at 265°F — near boiling, critical condition",
    },
    {
        "id": "ltft_saturation",
        "vehicleId": "honda-fit-2015",
        "snapshot": {
            "RPM": 820,
            "ECT": 197,
            "STFT_B1": 10.9,
            "LTFT_B1": 22.7,
        },
        "expected_tier": ["CRITICAL", "HIGH"],
        "description": "LTFT near max — ECU at limit of fuel correction",
    },
]

SYSTEM_PROMPT = (
    "You are an OBD2 diagnostic assistant. "
    "Analyze the snapshot and output an urgency level as one of: "
    "CRITICAL, HIGH, MEDIUM, LOW, or NORMAL. "
    "Start your response with the urgency level on its own line."
)


def extract_urgency(text: str) -> str | None:
    for level in URGENCY_LEVELS:
        if re.search(rf"\b{level}\b", text, re.IGNORECASE):
            return level.upper()
    return None


def call_agent(snapshot: dict) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Snapshot:\n```json\n{json.dumps(snapshot, indent=2)}\n```",
            },
        ],
        temperature=0,
    )
    return response.choices[0].message.content or ""


@pytest.mark.parametrize("case", URGENCY_CASES, ids=[c["id"] for c in URGENCY_CASES])
def test_urgency_tier(case):
    """Agent urgency label must fall within the expected tier set."""
    response = call_agent(case["snapshot"])
    urgency = extract_urgency(response)
    assert urgency is not None, (
        f"Case '{case['id']}': could not extract urgency level from response.\n"
        f"Response:\n{response}"
    )
    assert urgency in case["expected_tier"], (
        f"Case '{case['id']}': got urgency '{urgency}', "
        f"expected one of {case['expected_tier']}.\n"
        f"Response:\n{response}"
    )
