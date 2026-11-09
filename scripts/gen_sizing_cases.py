"""Regenerate shared/sizing-cases.json from the Python sizing formula.

Run from the repository root after changing ``server/src/lapis/sizing.py``:

    python scripts/gen_sizing_cases.py

Then make the same change in ``web/src/lib/sizing.ts``; both test-suites read the file.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server" / "src"))

from lapis.sizing import estimate_memory_gib, suggest_quant, verdict  # noqa: E402

ESTIMATES = [
    (0.14, "fp16", 2048), (1.5, "q8", 4096), (3, "q4", 4096), (7.6, "q4", 16384),
    (8, "q4", 8192), (8, "q8", 8192), (9.2, "q5", 8192), (14.7, "q4", 16384),
    (14, "q4", 8192), (24, "q4", 8192), (32.5, "q4", 8192), (32, "q8", 32768),
    (70, "q4", 8192), (70, "fp16", 4096), (405, "q4", 8192),
]
VERDICTS = [(5.79, 8), (6.9, 8), (7.5, 8), (9.18, 12), (19.1, 24), (23, 24), (40, 128), (0, 8), (5, 0)]
SUGGESTIONS = [(8, 8192, 8), (8, 8192, 24), (14, 8192, 12), (32, 8192, 24), (70, 8192, 24),
               (70, 8192, 128)]


def main() -> None:
    data = {
        "_comment": "Shared by server/tests/test_sizing.py and web/tests/sizing.test.ts. "
        "Regenerate with scripts/gen_sizing_cases.py.",
        "estimates": [
            {"params_b": p, "quant": q, "context": c, "expected_gib": estimate_memory_gib(p, q, c)}
            for p, q, c in ESTIMATES
        ],
        "verdicts": [
            {"needed_gib": n, "memory_gib": m, "verdict": verdict(n, m)} for n, m in VERDICTS
        ],
        "suggestions": [
            {"params_b": p, "context": c, "memory_gib": m, "quant": suggest_quant(p, c, m)}
            for p, c, m in SUGGESTIONS
        ],
    }
    out = ROOT / "shared" / "sizing-cases.json"
    out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
