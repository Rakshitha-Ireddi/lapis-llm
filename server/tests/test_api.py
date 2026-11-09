"""End-to-end through HTTP: admin API, enrolment endpoints and the /v1 router."""

import json

import pytest

from lapis.cli import build_parser, main

from .conftest import ADMIN_PASSWORD

pytestmark = pytest.mark.anyio


async def admin(harness):
    token = await harness.admin_token()
    return harness.master(Authorization=f"Bearer {token}")


async def test_health_and_login(harness):
    async with harness.master() as client:
        assert (await client.get("/healthz")).json()["status"] == "ok"
        bad = await client.post("/api/auth/login", json={"password": "nope"})
        assert bad.status_code == 403
        assert bad.json()["error"]["message"] == "wrong password"
        good = await client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
        assert good.status_code == 200 and good.json()["token"]


async def test_admin_api_requires_login(harness):
    async with harness.master() as client:
        for path in ("/api/overview", "/api/nodes", "/api/models", "/api/keys", "/api/audit"):
            assert (await client.get(path)).status_code == 403, path


async def test_enrolment_over_http(harness):
    agent = harness.add_agent("gaming-pc")
    async with harness.master() as master, await admin(harness) as console:
        node_id = await agent.enroll(master)
        assert not await agent.claim(master)

        nodes = (await console.get("/api/nodes")).json()
        assert nodes[0]["state"] == "pending"
        assert nodes[0]["fingerprint"] == agent.fingerprint
        assert "secret" not in nodes[0] and "public_key" not in nodes[0]

        wrong = await console.post(f"/api/nodes/{node_id}/approve", json={"fingerprint": "AA"})
        assert wrong.status_code == 403
        ok = await console.post(
            f"/api/nodes/{node_id}/approve", json={"fingerprint": agent.fingerprint}
        )
        assert ok.status_code == 200
        assert await agent.claim(master)
        assert await agent.heartbeat(master) == 200


async def test_model_lifecycle_and_inference(harness):
    await harness.join("gaming-pc", "gaming-pc")
    await harness.join("spark", "spark")
    async with await admin(harness) as console:
        created = await console.post(
            "/api/models", json={"name": "llama-8b", "params_b": 8, "context": 8192}
        )
        assert created.status_code == 201
        assert created.json()["budget_gib"] == 5.79

        preview = await console.post("/api/models/preview", json={"name": "x", "params_b": 70})
        rows = {r["node_name"]: r for r in preview.json()["nodes"]}
        assert not rows["gaming-pc"]["ok"] and rows["spark"]["chosen"]

        started = await console.post("/api/models/llama-8b/start")
        assert started.status_code == 200, started.text
        assert started.json()["state"] == "running"
        assert started.json()["node_name"] == "gaming-pc"

        key = (await console.post("/api/keys", json={"name": "laptop"})).json()
        assert key["key"].startswith("lap_")

    async with harness.master() as anon:
        denied = await anon.get("/v1/models")
        assert denied.status_code == 403
        assert "inference" in denied.json()["error"]["message"]

    async with harness.master(Authorization=f"Bearer {key['key']}") as client:
        models = (await client.get("/v1/models")).json()
        assert [m["id"] for m in models["data"]] == ["llama-8b"]
        assert models["data"][0]["lapis"]["node"] == "gaming-pc"

        chat = await client.post(
            "/v1/chat/completions",
            json={"model": "llama-8b", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert chat.status_code == 200
        assert chat.headers["x-lapis-node"] == "gaming-pc"
        assert chat.json()["choices"][0]["message"]["content"].startswith("Hi from llama-8b")

        stream = await client.post(
            "/v1/chat/completions",
            json={"model": "llama-8b", "messages": [], "stream": True, "max_tokens": 4},
        )
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert stream.text.rstrip().endswith("data: [DONE]")

        emb = await client.post("/v1/embeddings", json={"model": "llama-8b", "input": "x"})
        assert len(emb.json()["data"][0]["embedding"]) == 256

        missing = await client.post("/v1/chat/completions", json={"model": "nope"})
        assert missing.status_code == 404
        assert missing.json()["error"]["type"] == "not_found_error"

        no_model = await client.post("/v1/completions", json={"prompt": "x"})
        assert no_model.status_code == 400

        bad_json = await client.post("/v1/completions", content=b"{nope")
        assert bad_json.status_code == 400

        # inference keys cannot read metrics
        assert (await client.get("/metrics")).status_code == 403

    model = harness.fleet.models["llama-8b"]
    assert model.requests == 3
    assert model.tokens > 0

    async with await admin(harness) as console:
        metrics = await console.get("/metrics")
        assert 'lapis_requests_total{model="llama-8b",status="200"} 3' in metrics.text

        audit = (await console.get("/api/audit")).json()
        actions = [e["action"] for e in audit]
        assert "model.start" in actions and "key.create" in actions

        assert (await console.post("/api/models/llama-8b/stop")).json()["state"] == "stopped"
        assert (await console.delete("/api/models/llama-8b")).status_code == 204


async def test_validation_errors_are_readable(harness):
    async with await admin(harness) as console:
        response = await console.post("/api/models", json={"name": "Bad Name!", "params_b": 8})
        assert response.status_code == 422
        assert response.json()["error"]["message"].startswith("name:")


async def test_conflicts_map_to_409(harness):
    await harness.join("gaming-pc", "gaming-pc")
    async with await admin(harness) as console:
        await console.post("/api/models", json={"name": "big", "params_b": 70})
        response = await console.post("/api/models/big/start")
        assert response.status_code == 409
        assert "no node can run big" in response.json()["error"]["message"]


async def test_node_admin_actions(harness):
    agent = await harness.join("pc")
    async with await admin(harness) as console:
        assert (await console.post(f"/api/nodes/{agent.node_id}/drain")).json()[
            "state"
        ] == "draining"
        assert (await console.post(f"/api/nodes/{agent.node_id}/undrain")).json()[
            "state"
        ] == "online"
        assert (await console.post(f"/api/nodes/{agent.node_id}/revoke")).json()[
            "state"
        ] == "revoked"
        assert (await console.delete(f"/api/nodes/{agent.node_id}")).status_code == 204
        assert (await console.get("/api/nodes")).json() == []


async def test_backup_and_restore_endpoints(harness):
    async with await admin(harness) as console:
        await console.post("/api/models", json={"name": "m", "params_b": 1})
        backup = (await console.get("/api/backup")).json()
        await console.post("/api/models", json={"name": "extra", "params_b": 1})
        dry = (await console.post("/api/restore", json=backup)).json()
        assert dry["dry_run"] and dry["changes"]["models"]["remove"] == ["extra"]
        assert "extra" in harness.fleet.models
        real = (await console.post("/api/restore?dry_run=false", json=backup)).json()
        assert not real["dry_run"]
        assert list(harness.fleet.models) == ["m"]


async def test_api_keys_can_be_disabled(harness):
    harness.fleet.settings.require_api_key = False
    async with harness.master() as client:
        assert (await client.get("/v1/models")).status_code == 200


async def test_agent_rejects_calls_without_its_token(harness):
    agent = await harness.join("pc")
    import httpx

    app = harness.agent_apps[agent.url]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://a") as c:
        assert (await c.get("/agent/health")).json()["approved"] is True
        assert (await c.get("/agent/telemetry")).status_code == 401
        ok = await c.get("/agent/telemetry", headers={"X-Lapis-Token": agent.secret})
        assert ok.json()["platform"] == "windows"
        missing = await c.post(
            "/v1/chat/completions", json={"model": "x"}, headers={"X-Lapis-Token": agent.secret}
        )
        assert missing.status_code == 404


def test_cli_estimate(capsys):
    assert main(["estimate", "--params", "8", "--memory", "8"]) == 0
    out = capsys.readouterr().out
    assert "5.79 GiB" in out
    assert "comfortable" in out


def test_cli_parser_has_all_commands():
    parser = build_parser()
    for cmd in (["master"], ["demo"], ["agent", "--master", "http://m:8080"]):
        assert parser.parse_args(cmd).command == cmd[0]


def test_sse_usage_parser():
    from lapis.master.app import _usage_from_sse

    tail = (
        b'data: {"choices":[]}\n\n'
        + b"data: "
        + json.dumps({"usage": {"total_tokens": 12}}).encode()
        + b"\n\n"
        + b"data: [DONE]\n\n"
    )
    assert _usage_from_sse(tail) == 12
    assert _usage_from_sse(b"data: not-json\n\n") == 0


async def test_upstream_errors_keep_their_status(harness):
    """Found against a real llama-server: a 501 must not be relayed as 200."""
    from lapis.agent.runtimes import SimulatedRuntime, UpstreamError

    class Failing(SimulatedRuntime):
        async def handle(self, kind, body):
            raise UpstreamError(501, {"error": {"message": "start it with --embeddings"}})

    await harness.join("pc", runtime_factory=lambda spec, node: Failing(spec, node.name))
    harness.fleet.add_model(spec_for("m"))
    await harness.fleet.start_model("m")
    token = await harness.admin_token()
    async with harness.master(Authorization=f"Bearer {token}") as client:
        response = await client.post("/v1/embeddings", json={"model": "m", "input": "x"})
    assert response.status_code == 501
    assert "--embeddings" in response.json()["error"]["message"]
    assert 'status="501"' in harness.fleet.metrics.render([], [])


def spec_for(name: str):
    from lapis.domain import ModelSpec

    return ModelSpec(name=name, params_b=1)
