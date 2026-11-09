from lapis import admission, placement
from lapis.domain import GPU, Node, NodeState, Platform, RuntimeKind, Telemetry

from .conftest import spec

SIM = [RuntimeKind.SIMULATED]


def discrete(*gpus: tuple[float, float]) -> Telemetry:
    cards = [
        GPU(index=i, name=f"GPU{i}", memory_total_gib=total, memory_used_gib=used)
        for i, (total, used) in enumerate(gpus)
    ]
    return Telemetry(
        platform=Platform.LINUX,
        memory_total_gib=sum(g.memory_total_gib for g in cards),
        memory_used_gib=sum(g.memory_used_gib for g in cards),
        gpus=cards,
    )


def unified(total: float, used: float) -> Telemetry:
    return Telemetry(
        platform=Platform.MACOS, unified_memory=True, memory_total_gib=total, memory_used_gib=used
    )


def node(name: str, telemetry: Telemetry | None, runtimes=None) -> Node:
    return Node(
        id=f"node-{name}",
        name=name,
        url=f"http://{name}",
        platform=Platform.LINUX,
        runtimes=runtimes or SIM,
        public_key="0" * 64,
        fingerprint="00",
        state=NodeState.ONLINE,
        created_at=0,
        telemetry=telemetry,
    )


class TestAdmission:
    def test_unified_memory_fits(self):
        result = admission.check(10, RuntimeKind.SIMULATED, SIM, unified(36, 9), reserve_gib=1)
        assert result.ok
        assert result.headroom_gib == 16.0
        assert "26.00 GiB free" in result.reason

    def test_unified_memory_refuses_with_reason(self):
        result = admission.check(30, RuntimeKind.SIMULATED, SIM, unified(36, 9), reserve_gib=1)
        assert not result.ok
        assert result.reason == (
            "needs 30.00 GiB but only 26.00 GiB is free after the 1.00 GiB reserve"
        )

    def test_reserve_is_respected(self):
        assert admission.check(7, RuntimeKind.SIMULATED, SIM, unified(8, 0), reserve_gib=0).ok
        assert not admission.check(7, RuntimeKind.SIMULATED, SIM, unified(8, 0), reserve_gib=2).ok

    def test_discrete_gpus_checked_per_card(self):
        # Two 8 GiB cards = 16 GiB total, but a 10 GiB model fits on neither.
        tel = discrete((8, 0), (8, 0))
        result = admission.check(10, RuntimeKind.SIMULATED, SIM, tel, reserve_gib=0.5)
        assert not result.ok
        assert "roomiest GPU" in result.reason

    def test_discrete_picks_the_roomiest_gpu(self):
        tel = discrete((24, 20), (24, 2))
        result = admission.check(10, RuntimeKind.SIMULATED, SIM, tel, reserve_gib=1)
        assert result.ok
        assert result.gpu_index == 1

    def test_runtime_must_be_offered(self):
        result = admission.check(1, RuntimeKind.VLLM, [RuntimeKind.MLX], unified(64, 0), 1)
        assert not result.ok
        assert result.reason == "node does not offer runtime vllm (offers mlx)"

    def test_no_telemetry_yet(self):
        result = admission.check(1, RuntimeKind.SIMULATED, SIM, None, 1)
        assert not result.ok
        assert "telemetry" in result.reason


class TestPlacement:
    def test_best_fit_keeps_big_nodes_free(self):
        nodes = [
            node("spark", unified(128, 6)),
            node("gaming-pc", discrete((8, 0.6))),
            node("linux-box", discrete((24, 0.4))),
        ]
        candidates = placement.evaluate(spec(params_b=8), nodes, lambda n: n.state, 1)
        assert placement.choose(candidates).node.name == "gaming-pc"

    def test_skips_nodes_that_are_not_online(self):
        draining = node("gaming-pc", discrete((8, 0)))
        draining.state = NodeState.DRAINING
        nodes = [draining, node("linux-box", discrete((24, 0)))]
        candidates = placement.evaluate(spec(params_b=8), nodes, lambda n: n.state, 1)
        assert placement.choose(candidates).node.name == "linux-box"
        assert candidates[0].admission.reason == "node is draining"

    def test_nothing_fits(self):
        nodes = [node("gaming-pc", discrete((8, 0)))]
        candidates = placement.evaluate(spec(params_b=70), nodes, lambda n: n.state, 1)
        assert placement.choose(candidates) is None
