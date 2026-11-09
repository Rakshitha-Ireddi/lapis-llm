import pytest

from lapis.sizing import (
    estimate_memory_gib,
    kv_cache_gib,
    suggest_quant,
    verdict,
    weights_gib,
)


def test_estimates_match_shared_fixture(sizing_cases):
    for case in sizing_cases["estimates"]:
        got = estimate_memory_gib(case["params_b"], case["quant"], case["context"])
        assert got == pytest.approx(case["expected_gib"], abs=0.005), case


def test_verdicts_match_shared_fixture(sizing_cases):
    for case in sizing_cases["verdicts"]:
        assert verdict(case["needed_gib"], case["memory_gib"]) == case["verdict"], case


def test_suggestions_match_shared_fixture(sizing_cases):
    for case in sizing_cases["suggestions"]:
        got = suggest_quant(case["params_b"], case["context"], case["memory_gib"])
        assert got == case["quant"], case


@pytest.mark.parametrize(
    ("params_b", "memory_gib"),
    [(8, 8), (14, 12), (32, 24)],
    ids=["8B-on-8GB", "14B-on-12GB", "32B-on-24GB"],
)
def test_rule_of_thumb_for_4bit_models(params_b, memory_gib):
    assert verdict(estimate_memory_gib(params_b, "q4", 8192), memory_gib) == "comfortable"


def test_more_context_needs_more_memory():
    assert kv_cache_gib(8, 32768) == pytest.approx(4 * kv_cache_gib(8, 8192))
    assert estimate_memory_gib(8, "q4", 32768) > estimate_memory_gib(8, "q4", 8192)


def test_higher_precision_needs_more_memory():
    sizes = [weights_gib(8, q) for q in ("q4", "q5", "q6", "q8", "fp16")]
    assert sizes == sorted(sizes)


@pytest.mark.parametrize(
    "call",
    [
        lambda: weights_gib(8, "q3"),
        lambda: weights_gib(0, "q4"),
        lambda: kv_cache_gib(8, 0),
    ],
)
def test_bad_inputs_raise(call):
    with pytest.raises(ValueError):
        call()
