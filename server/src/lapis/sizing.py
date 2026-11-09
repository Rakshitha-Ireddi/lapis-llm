"""Memory sizing rules of thumb.

The same formula lives in ``web/src/lib/sizing.ts`` and both implementations are
checked against ``shared/sizing-cases.json`` so the "Will it run?" calculator on
the website never disagrees with the admission check on the master.
"""

from __future__ import annotations

import math
from typing import Literal

#: Effective bits per weight, including quantisation scales/zero points.
QUANT_BITS: dict[str, float] = {
    "q4": 4.5,
    "q5": 5.5,
    "q6": 6.5,
    "q8": 8.5,
    "fp16": 16.0,
}

#: Runtime buffers, CUDA/Metal context, tokenizer and friends.
OVERHEAD_GIB = 0.6

#: KV cache for an 8B model with grouped-query attention at fp16, per token.
KV_MIB_PER_TOKEN_8B = 0.125

Verdict = Literal["comfortable", "tight", "too-big"]


def _round2(value: float) -> float:
    """Round half-up to 2 decimals (matches ``Math.round`` in the web client)."""
    return math.floor(value * 100 + 0.5) / 100


def weights_gib(params_b: float, quant: str = "q4") -> float:
    if quant not in QUANT_BITS:
        raise ValueError(f"unknown quantisation {quant!r}")
    if params_b <= 0:
        raise ValueError("params_b must be positive")
    return params_b * 1e9 * QUANT_BITS[quant] / 8 / 2**30


def kv_cache_gib(params_b: float, context: int) -> float:
    if context <= 0:
        raise ValueError("context must be positive")
    per_token_mib = KV_MIB_PER_TOKEN_8B * (params_b / 8) ** 0.4
    return context * per_token_mib / 1024


def estimate_memory_gib(params_b: float, quant: str = "q4", context: int = 8192) -> float:
    """Estimate the memory a model needs to serve one context window."""
    total = weights_gib(params_b, quant) + kv_cache_gib(params_b, context) + OVERHEAD_GIB
    return _round2(total)


def verdict(needed_gib: float, memory_gib: float) -> Verdict:
    """Classify whether ``needed_gib`` fits in a machine with ``memory_gib``."""
    if memory_gib <= 0:
        return "too-big"
    ratio = needed_gib / memory_gib
    if ratio <= 0.85:
        return "comfortable"
    if ratio <= 0.95:
        return "tight"
    return "too-big"


def suggest_quant(params_b: float, context: int, memory_gib: float) -> str | None:
    """Return the highest-quality quantisation that fits comfortably, if any."""
    for quant in ("fp16", "q8", "q6", "q5", "q4"):
        if verdict(estimate_memory_gib(params_b, quant, context), memory_gib) == "comfortable":
            return quant
    return None
