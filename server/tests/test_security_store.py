import json

import pytest

from lapis.audit import AuditLog
from lapis.config import Settings
from lapis.metrics import Metrics
from lapis.security import (
    SessionSigner,
    fingerprint,
    fingerprints_match,
    new_api_key,
    new_identity,
    public_key_for,
)
from lapis.store import JsonStore

from .conftest import FakeClock


def test_fingerprint_is_stable_and_readable():
    public = public_key_for("a" * 64)
    fp = fingerprint(public)
    assert fp == fingerprint(public)
    assert len(fp.split(":")) == 16
    assert all(len(part) == 2 for part in fp.split(":"))


def test_fingerprint_comparison_ignores_formatting():
    fp = fingerprint(public_key_for(new_identity()))
    assert fingerprints_match(fp, fp.replace(":", "").lower())
    assert fingerprints_match(fp, " " + fp.replace(":", " ") + " ")
    assert not fingerprints_match(fp, fp[:-1] + ("0" if fp[-1] != "0" else "1"))


def test_api_keys_are_prefixed_and_unique():
    keys = {new_api_key() for _ in range(50)}
    assert len(keys) == 50
    assert all(k.startswith("lap_") and len(k) > 30 for k in keys)


class TestSessionSigner:
    def test_issue_and_verify(self):
        signer = SessionSigner("secret")
        assert signer.verify(signer.issue())

    def test_rejects_tampering_and_garbage(self):
        signer = SessionSigner("secret")
        token = signer.issue()
        expiry, sig = token.split(".")
        assert not signer.verify(f"{int(expiry) + 999}.{sig}")
        assert not SessionSigner("other").verify(token)
        for bad in (None, "", "nodot", "abc.def"):
            assert not signer.verify(bad)

    def test_expires(self):
        clock = FakeClock()
        signer = SessionSigner("secret", ttl_seconds=60, clock=clock)
        token = signer.issue()
        clock.advance(61)
        assert not signer.verify(token)


class TestJsonStore:
    def test_round_trip_on_disk(self, tmp_path):
        store = JsonStore(tmp_path / "nested" / "state.json")
        assert store.load() == {}
        store.save({"models": [1, 2]})
        assert JsonStore(tmp_path / "nested" / "state.json").load() == {"models": [1, 2]}
        assert not list((tmp_path / "nested").glob(".state-*"))

    def test_in_memory_is_isolated_from_caller_mutation(self):
        store = JsonStore(None)
        data = {"a": [1]}
        store.save(data)
        data["a"].append(2)
        assert store.load() == {"a": [1]}


def test_audit_log_persists_and_reloads(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl", clock=FakeClock())
    log.record("admin", "model.add", "llama")
    log.record("admin", "model.start", "llama", "gaming-pc")
    reloaded = AuditLog(tmp_path / "audit.jsonl")
    assert [e["action"] for e in reloaded.recent()] == ["model.start", "model.add"]
    lines = (tmp_path / "audit.jsonl").read_text().splitlines()
    assert json.loads(lines[0])["target"] == "llama"


def test_metrics_render_prometheus_text():
    metrics = Metrics()
    metrics.observe("llama", 200, 42)
    metrics.observe("llama", 200, 8)
    metrics.observe('we"ird', 503, 0)
    text = metrics.render(
        [
            {
                "name": "pc",
                "state": "online",
                "telemetry": {"memory_total_gib": 8, "memory_used_gib": 3},
            }
        ],
        [{"spec": {"name": "llama"}, "state": "running"}],
    )
    assert 'lapis_requests_total{model="llama",status="200"} 2' in text
    assert 'lapis_tokens_total{model="llama"} 50' in text
    assert 'model="we\\"ird"' in text
    assert 'lapis_node_up{node="pc"} 1' in text
    assert 'lapis_node_memory_free_gib{node="pc"} 5.00' in text
    assert metrics.requests_total == 3


class TestSettings:
    def test_from_env(self, tmp_path):
        s = Settings.from_env(
            {
                "LAPIS_DATA_DIR": str(tmp_path),
                "LAPIS_ADMIN_PASSWORD": "pw",
                "LAPIS_REQUIRE_API_KEY": "false",
                "LAPIS_MEMORY_RESERVE_GIB": "2.5",
                "LAPIS_CORS_ORIGINS": "https://a.example, https://b.example",
            }
        )
        assert s.data_dir == tmp_path
        assert s.admin_password == "pw" and not s.password_generated
        assert s.require_api_key is False
        assert s.memory_reserve_gib == 2.5
        assert s.cors_origins == ["https://a.example", "https://b.example"]

    def test_generates_password_when_missing(self):
        s = Settings.from_env({})
        assert s.password_generated
        assert len(s.admin_password) >= 12


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_truthy_env_values(value):
    assert Settings.from_env({"LAPIS_AUTO_APPROVE": value}).auto_approve
