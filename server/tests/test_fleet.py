"""Fleet behaviour, driven through real in-process agents."""

import pytest

from lapis.domain import (
    EnrollRequest,
    ModelState,
    NodeState,
    Platform,
    RuntimeKind,
    Scope,
)
from lapis.master.fleet import Conflict, Fleet, Forbidden, NotFound, Unavailable
from lapis.security import new_identity, public_key_for
from lapis.store import JsonStore

from .conftest import spec

pytestmark = pytest.mark.anyio


def enroll_request(name="pc", identity=None) -> tuple[EnrollRequest, str]:
    identity = identity or new_identity()
    return (
        EnrollRequest(
            name=name,
            url=f"http://{name}:8101",
            platform=Platform.WINDOWS,
            runtimes=[RuntimeKind.SIMULATED],
            public_key=public_key_for(identity),
        ),
        identity,
    )


class TestEnrolment:
    async def test_pending_until_approved_with_matching_fingerprint(self, harness):
        fleet = harness.fleet
        req, identity = enroll_request()
        node = fleet.enroll(req)
        assert node.state == NodeState.PENDING
        assert fleet.claim(node.id, identity) is None

        with pytest.raises(Forbidden, match="fingerprint"):
            fleet.approve(node.id, "00:11:22")
        fleet.approve(node.id, node.fingerprint.lower().replace(":", ""))
        assert fleet.claim(node.id, identity) == node.secret

    async def test_claim_requires_the_identity(self, harness):
        req, _ = enroll_request()
        node = harness.fleet.enroll(req)
        with pytest.raises(Forbidden):
            harness.fleet.claim(node.id, new_identity())

    async def test_re_enrolment_is_idempotent(self, harness):
        req, _ = enroll_request()
        first = harness.fleet.enroll(req)
        second = harness.fleet.enroll(req.model_copy(update={"url": "http://pc:9999"}))
        assert first.id == second.id
        assert second.url == "http://pc:9999"
        assert len(harness.fleet.nodes) == 1

    async def test_auto_approve(self, harness):
        harness.fleet.settings.auto_approve = True
        node = harness.fleet.enroll(enroll_request()[0])
        assert node.state == NodeState.ONLINE

    async def test_approving_twice_conflicts(self, harness):
        node = harness.fleet.enroll(enroll_request()[0])
        harness.fleet.approve(node.id, node.fingerprint)
        with pytest.raises(Conflict):
            harness.fleet.approve(node.id, node.fingerprint)

    async def test_heartbeat_needs_the_secret(self, harness):
        agent = await harness.join("pc")
        with pytest.raises(Forbidden):
            await harness.fleet.heartbeat(agent.node_id, "nope", agent.telemetry())
        with pytest.raises(NotFound):
            await harness.fleet.heartbeat("node-missing", "x", agent.telemetry())

    async def test_node_goes_offline_without_heartbeats(self, harness):
        agent = await harness.join("pc")
        node = harness.fleet.nodes[agent.node_id]
        assert harness.fleet.effective_state(node) == NodeState.ONLINE
        harness.clock.advance(31)
        assert harness.fleet.effective_state(node) == NodeState.OFFLINE
        await harness.heartbeat("pc")
        assert harness.fleet.effective_state(node) == NodeState.ONLINE


class TestModels:
    async def test_start_places_on_best_fit_and_stop(self, harness):
        await harness.join("gaming-pc", "gaming-pc")
        await harness.join("spark", "spark")
        fleet = harness.fleet
        fleet.add_model(spec("llama-8b", 8))
        model = await fleet.start_model("llama-8b")
        assert model.state == ModelState.RUNNING
        assert fleet.nodes[model.node_id].name == "gaming-pc"
        assert "llama-8b" in harness.agents["gaming-pc"].models

        await fleet.stop_model("llama-8b")
        assert model.state == ModelState.STOPPED
        assert harness.agents["gaming-pc"].models == {}

    async def test_big_model_goes_to_the_big_node(self, harness):
        await harness.join("gaming-pc", "gaming-pc")
        await harness.join("spark", "spark")
        harness.fleet.add_model(spec("llama-70b", 70))
        model = await harness.fleet.start_model("llama-70b")
        assert harness.fleet.nodes[model.node_id].name == "spark"

    async def test_refusal_explains_every_node(self, harness):
        await harness.join("gaming-pc", "gaming-pc")
        harness.fleet.add_model(spec("llama-70b", 70))
        with pytest.raises(Conflict, match=r"no node can run llama-70b \(gaming-pc: needs"):
            await harness.fleet.start_model("llama-70b")
        assert harness.fleet.models["llama-70b"].state == ModelState.FAILED

    async def test_explicit_node_refusal(self, harness):
        agent = await harness.join("gaming-pc", "gaming-pc")
        harness.fleet.add_model(spec("qwen-14b", 14))
        with pytest.raises(Conflict, match="refused qwen-14b"):
            await harness.fleet.start_model("qwen-14b", agent.node_id)
        assert "roomiest GPU" in harness.fleet.models["qwen-14b"].last_error

    async def test_agent_has_the_final_word_on_memory(self, harness):
        """The master's telemetry can be stale; the agent re-checks before starting."""
        agent = await harness.join("gaming-pc", "gaming-pc")
        harness.fleet.add_model(spec("a", 5))
        harness.fleet.add_model(spec("b", 5))
        await harness.fleet.start_model("a")
        # Pretend the master missed the update and still thinks the GPU is empty.
        node = harness.fleet.nodes[agent.node_id]
        node.telemetry = node.telemetry.model_copy(
            update={
                "gpus": [g.model_copy(update={"memory_used_gib": 0}) for g in node.telemetry.gpus]
            }
        )
        with pytest.raises(Conflict, match="refused b"):
            await harness.fleet.start_model("b", agent.node_id)

    async def test_add_duplicate_and_remove_running(self, harness):
        await harness.join("pc")
        harness.fleet.add_model(spec("m", 1))
        with pytest.raises(Conflict):
            harness.fleet.add_model(spec("m", 1))
        await harness.fleet.start_model("m")
        with pytest.raises(Conflict, match="stop m"):
            harness.fleet.remove_model("m")
        await harness.fleet.stop_model("m")
        harness.fleet.remove_model("m")
        assert "m" not in harness.fleet.models

    async def test_drain_blocks_new_placements(self, harness):
        agent = await harness.join("pc")
        harness.fleet.drain(agent.node_id)
        harness.fleet.add_model(spec("m", 1))
        with pytest.raises(Conflict, match="node is draining"):
            await harness.fleet.start_model("m")
        harness.fleet.undrain(agent.node_id)
        assert (await harness.fleet.start_model("m")).state == ModelState.RUNNING

    async def test_move_between_nodes(self, harness):
        a = await harness.join("pc-a", "linux-box")
        b = await harness.join("pc-b", "linux-box")
        harness.fleet.add_model(spec("m", 8))
        await harness.fleet.start_model("m", a.node_id)
        model = await harness.fleet.move_model("m", b.node_id)
        assert model.node_id == b.node_id and model.state == ModelState.RUNNING
        assert "m" not in harness.agents["pc-a"].models
        assert "m" in harness.agents["pc-b"].models
        with pytest.raises(Conflict, match="already"):
            await harness.fleet.move_model("m", b.node_id)

    async def test_preview_marks_the_chosen_node(self, harness):
        await harness.join("gaming-pc", "gaming-pc")
        await harness.join("spark", "spark")
        rows = {r["node_name"]: r for r in harness.fleet.preview(spec("m", 8))}
        assert rows["gaming-pc"]["chosen"] and rows["gaming-pc"]["ok"]
        assert rows["spark"]["ok"] and not rows["spark"]["chosen"]

    async def test_revoke_frees_models(self, harness):
        agent = await harness.join("pc")
        harness.fleet.add_model(spec("m", 1))
        await harness.fleet.start_model("m")
        harness.fleet.revoke(agent.node_id)
        model = harness.fleet.models["m"]
        assert model.node_id is None and model.state == ModelState.STOPPED
        with pytest.raises(Forbidden):
            harness.fleet.claim(agent.node_id, agent.identity)
        harness.fleet.remove_node(agent.node_id)
        assert agent.node_id not in harness.fleet.nodes

    async def test_remove_requires_revoke(self, harness):
        agent = await harness.join("pc")
        with pytest.raises(Conflict):
            harness.fleet.remove_node(agent.node_id)


class TestRecoveryAndRouting:
    async def test_agent_restart_brings_running_models_back(self, harness):
        await harness.join("pc", "linux-box")
        fleet = harness.fleet
        for name in ("a", "b"):
            fleet.add_model(spec(name, 1))
            await fleet.start_model(name)
        fleet.add_model(spec("stopped-on-purpose", 1))
        await fleet.start_model("stopped-on-purpose")
        await fleet.stop_model("stopped-on-purpose")

        # Simulate the agent process restarting: it comes back with nothing running.
        agent = harness.agents["pc"]
        agent.models.clear()
        agent.gpu_of.clear()
        await harness.heartbeat("pc")

        assert sorted(agent.models) == ["a", "b"]
        assert fleet.models["a"].state == ModelState.RUNNING
        assert fleet.models["stopped-on-purpose"].state == ModelState.STOPPED

    async def test_route(self, harness):
        await harness.join("pc")
        harness.fleet.add_model(spec("m", 1))
        with pytest.raises(NotFound):
            harness.fleet.route("nope")
        with pytest.raises(Unavailable, match="not running"):
            harness.fleet.route("m")
        await harness.fleet.start_model("m")
        _model, node = harness.fleet.route("m")
        assert node.name == "pc"
        harness.clock.advance(60)
        with pytest.raises(Unavailable, match="offline"):
            harness.fleet.route("m")

    async def test_unreachable_agent_is_unavailable(self, harness):
        agent = await harness.join("pc")
        harness.fleet.add_model(spec("m", 1))
        del harness.agent_apps[agent.url]  # the transport factory now raises KeyError
        harness.fleet.agents._transport_factory = None
        harness.fleet.agents._clients.clear()
        harness.fleet.nodes[agent.node_id].url = "http://127.0.0.1:9"
        with pytest.raises(Unavailable):
            await harness.fleet.start_model("m")


class TestKeysAndBackup:
    async def test_keys_are_hashed_and_scoped(self, harness):
        key, plaintext = harness.fleet.create_key("laptop", [Scope.INFERENCE])
        assert plaintext not in str(harness.fleet._snapshot(include_secrets=True))
        assert harness.fleet.check_key(plaintext, Scope.INFERENCE) is key
        assert harness.fleet.check_key(plaintext, Scope.METRICS) is None
        assert harness.fleet.check_key("lap_wrong", Scope.INFERENCE) is None
        harness.fleet.revoke_key(key.id)
        assert harness.fleet.check_key(plaintext, Scope.INFERENCE) is None
        with pytest.raises(NotFound):
            harness.fleet.revoke_key(key.id)

    async def test_state_survives_a_master_restart(self, harness, settings, tmp_path):
        store = JsonStore(tmp_path / "state.json")
        fleet = Fleet(settings, store=store, agents=harness.fleet.agents)
        fleet.add_model(spec("m", 3))
        fleet.create_key("k", [Scope.INFERENCE])
        reloaded = Fleet(settings, store=JsonStore(tmp_path / "state.json"))
        assert list(reloaded.models) == ["m"]
        assert len(reloaded.keys) == 1

    async def test_backup_excludes_secrets_and_restore_previews(self, harness):
        agent = await harness.join("pc")
        harness.fleet.add_model(spec("m", 1))
        backup = harness.fleet.export_state()
        assert all("secret" not in n for n in backup["nodes"])

        harness.fleet.add_model(spec("extra", 1))
        preview = harness.fleet.restore_preview(backup)
        assert preview["models"] == {"add": [], "keep": ["m"], "remove": ["extra"]}

        old_secret = harness.fleet.nodes[agent.node_id].secret
        harness.fleet.restore(backup)
        assert "extra" not in harness.fleet.models
        new_secret = harness.fleet.nodes[agent.node_id].secret
        assert new_secret and new_secret != old_secret
        # The agent's old secret is now rejected; it re-claims with its identity.
        assert await harness.heartbeat("pc") == 403
        assert harness.fleet.claim(agent.node_id, agent.identity) == new_secret

    async def test_restore_rejects_unknown_versions(self, harness):
        from lapis.master.fleet import FleetError

        with pytest.raises(FleetError, match="version"):
            harness.fleet.restore_preview({"version": 99})

    async def test_overview_kpis(self, harness):
        await harness.join("gaming-pc", "gaming-pc")
        await harness.join("spark", "spark")
        harness.fleet.add_model(spec("m", 8))
        await harness.fleet.start_model("m")
        kpis = harness.fleet.overview()["kpis"]
        assert kpis["nodes_online"] == 2
        assert kpis["models_running"] == 1
        assert kpis["memory_total_gib"] == 136
