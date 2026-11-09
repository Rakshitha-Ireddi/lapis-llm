import json
import math

import pytest

from lapis.agent.hardware import PRESETS, parse_nvidia_smi
from lapis.agent.runtimes import SimulatedRuntime, TokenRate, build_command
from lapis.domain import ModelSpec, Platform, RuntimeKind

from .conftest import FakeClock, spec

pytestmark = pytest.mark.anyio


class TestCommands:
    def test_llama_cpp_from_hugging_face(self):
        s = ModelSpec(
            name="qwen",
            source="Qwen/Qwen2.5-7B-GGUF",
            runtime=RuntimeKind.LLAMA_CPP,
            params_b=7,
            context=8192,
            parallel=2,
        )
        cmd = build_command(s, 9001)
        assert cmd[0] == "llama-server"
        assert cmd[1:3] == ["-hf", "Qwen/Qwen2.5-7B-GGUF"]
        assert cmd[cmd.index("--port") + 1] == "9001"
        assert cmd[cmd.index("-c") + 1] == "16384"  # context is per slot
        assert cmd[cmd.index("--alias") + 1] == "qwen"

    def test_llama_cpp_from_local_gguf(self):
        s = ModelSpec(
            name="m", source="/models/m.Q4_K_M.gguf", runtime=RuntimeKind.LLAMA_CPP, params_b=7
        )
        assert build_command(s, 1)[1:3] == ["-m", "/models/m.Q4_K_M.gguf"]

    def test_vllm(self):
        s = ModelSpec(
            name="qwen-32b",
            source="Qwen/Qwen2.5-32B-Instruct-AWQ",
            runtime=RuntimeKind.VLLM,
            params_b=32,
            context=8192,
            parallel=16,
        )
        cmd = build_command(s, 9002, gpu_memory_utilization=0.8)
        assert cmd[:3] == ["vllm", "serve", "Qwen/Qwen2.5-32B-Instruct-AWQ"]
        assert cmd[cmd.index("--served-model-name") + 1] == "qwen-32b"
        assert cmd[cmd.index("--max-num-seqs") + 1] == "16"
        assert cmd[-2:] == ["--gpu-memory-utilization", "0.80"]

    def test_mlx(self):
        s = ModelSpec(
            name="m", source="mlx-community/Llama-3.2-3B-4bit", runtime=RuntimeKind.MLX, params_b=3
        )
        assert build_command(s, 7)[:3] == [
            "mlx_lm.server",
            "--model",
            "mlx-community/Llama-3.2-3B-4bit",
        ]

    def test_binary_override(self, monkeypatch):
        monkeypatch.setenv("LAPIS_LLAMA_SERVER", r"C:\llama\llama-server.exe")
        s = ModelSpec(name="m", source="x.gguf", runtime=RuntimeKind.LLAMA_CPP, params_b=1)
        assert build_command(s, 1)[0] == r"C:\llama\llama-server.exe"

    def test_simulated_is_not_a_process(self):
        with pytest.raises(ValueError):
            build_command(spec(), 1)


class TestSimulatedRuntime:
    async def test_chat_is_deterministic_and_openai_shaped(self):
        rt = SimulatedRuntime(spec("llama-8b"), "gaming-pc")
        await rt.start()
        body = {"model": "llama-8b", "messages": [{"role": "user", "content": "hi"}]}
        first, second = await rt.handle("chat", body), await rt.handle("chat", body)
        assert first["choices"][0]["message"] == second["choices"][0]["message"]
        assert first["object"] == "chat.completion"
        assert first["choices"][0]["message"]["content"].startswith(
            "Hi from llama-8b on gaming-pc."
        )
        usage = first["usage"]
        assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]

    async def test_max_tokens_truncates(self):
        rt = SimulatedRuntime(spec())
        await rt.start()
        out = await rt.handle("completions", {"prompt": "x", "max_tokens": 3})
        assert len(out["choices"][0]["text"].split()) == 3
        assert out["object"] == "text_completion"

    async def test_stream_emits_sse_with_usage_and_done(self):
        rt = SimulatedRuntime(spec())
        await rt.start()
        stream = await rt.handle("chat", {"messages": [], "stream": True, "max_tokens": 5})
        events = [chunk async for chunk in stream]
        assert events[-1] == b"data: [DONE]\n\n"
        payloads = [json.loads(e[6:]) for e in events[:-1]]
        assert payloads[0]["choices"][0]["delta"]["role"] == "assistant"
        text = "".join(p["choices"][0]["delta"].get("content", "") for p in payloads)
        assert len(text.split()) == 5
        assert payloads[-1]["usage"]["completion_tokens"] == 5
        assert rt.in_flight == 0

    async def test_embeddings_are_unit_vectors(self):
        rt = SimulatedRuntime(spec("embed", 0.1))
        await rt.start()
        out = await rt.handle("embeddings", {"input": ["a", "b"]})
        vectors = [d["embedding"] for d in out["data"]]
        assert len(vectors) == 2 and len(vectors[0]) == 256
        assert math.isclose(sum(v * v for v in vectors[0]), 1.0, rel_tol=1e-3)
        assert vectors[0] != vectors[1]

    async def test_refuses_when_stopped(self):
        from lapis.agent.runtimes import RuntimeError_

        rt = SimulatedRuntime(spec())
        with pytest.raises(RuntimeError_):
            await rt.handle("chat", {})

    def test_bigger_models_are_slower(self):
        assert (
            SimulatedRuntime(spec(params_b=70)).nominal_tps < SimulatedRuntime(spec()).nominal_tps
        )


def test_token_rate_window():
    clock = FakeClock(0)
    rate = TokenRate(window_s=10, clock=clock)
    rate.add(50)
    rate.add(50)
    assert rate.value() == 10.0
    clock.advance(11)
    assert rate.value() == 0.0


class TestHardware:
    def test_parse_nvidia_smi(self):
        out = (
            "0, NVIDIA GeForce RTX 3090, 24576, 1024, 7\n"
            "1, NVIDIA GeForce RTX 3070, 8192, 512, [N/A]\n"
        )
        gpus = parse_nvidia_smi(out)
        assert [g.name for g in gpus] == ["NVIDIA GeForce RTX 3090", "NVIDIA GeForce RTX 3070"]
        assert gpus[0].memory_total_gib == 24.0
        assert gpus[0].memory_used_gib == 1.0
        assert gpus[0].utilization == 7
        assert gpus[1].utilization == 0

    def test_parse_ignores_junk(self):
        assert parse_nvidia_smi("No devices were found\n") == []

    def test_presets(self):
        assert PRESETS["gaming-pc"].pool_gib == 8
        assert PRESETS["spark"].pool_gib == 128
        assert PRESETS["macbook"].default_runtimes() == [RuntimeKind.LLAMA_CPP, RuntimeKind.MLX]
        assert PRESETS["linux-box"].default_runtimes()[0] == RuntimeKind.VLLM
        assert PRESETS["gaming-pc"].platform == Platform.WINDOWS


class TestEmbeddingsFlag:
    def test_embedding_models_get_the_switch(self):
        s = ModelSpec(
            name="nomic-embed-text",
            source="/m/nomic.gguf",
            runtime=RuntimeKind.LLAMA_CPP,
            params_b=0.14,
        )
        assert "--embeddings" in build_command(s, 1)

    def test_chat_models_do_not(self):
        s = ModelSpec(
            name="qwen", source="/m/qwen.gguf", runtime=RuntimeKind.LLAMA_CPP, params_b=0.5
        )
        assert "--embeddings" not in build_command(s, 1)


@pytest.mark.parametrize("runtime", [RuntimeKind.LLAMA_CPP, RuntimeKind.VLLM, RuntimeKind.MLX])
def test_extra_args_are_appended(runtime):
    s = ModelSpec(name="m", source="x/y", runtime=runtime, params_b=1, args=["--pooling", "mean"])
    assert build_command(s, 1)[-2:] == ["--pooling", "mean"]


class TestSharedGpuSafety:
    """Found on a shared 8x RTX 3090 lab server."""

    def test_child_env_pins_one_gpu_in_nvidia_smi_order(self):
        from lapis.agent.runtimes import child_env

        env = child_env(1, base={"PATH": "/bin"})
        assert env["CUDA_VISIBLE_DEVICES"] == "1"
        assert env["CUDA_DEVICE_ORDER"] == "PCI_BUS_ID"
        assert env["PATH"] == "/bin"
        assert "CUDA_VISIBLE_DEVICES" not in child_env(None, base={})

    def test_select_gpus(self):
        from lapis.agent.hardware import select_gpus
        from lapis.domain import GPU

        gpus = [GPU(index=i, name="3090", memory_total_gib=24) for i in range(8)]
        assert [g.index for g in select_gpus(gpus, {1, 3})] == [1, 3]
        assert len(select_gpus(gpus, None)) == 8


class TestLiveTelemetry:
    def _node(self, live):
        from lapis.agent.hardware import Hardware
        from lapis.agent.node import AgentNode
        from lapis.domain import GPU, Platform

        hw = Hardware(
            platform=Platform.LINUX,
            accelerator="RTX 3090",
            gpus=[GPU(index=1, name="RTX 3090", memory_total_gib=24, memory_used_gib=2.7)],
        )
        return AgentNode(
            name="gpu1",
            url="http://x",
            hardware=hw,
            runtimes=[RuntimeKind.SIMULATED],
            live_gpus=live,
        )

    async def test_live_readings_include_other_peoples_jobs(self):
        from lapis.domain import GPU

        reading = [
            GPU(index=1, name="RTX 3090", memory_total_gib=24, memory_used_gib=20, utilization=88)
        ]
        node = self._node(lambda: reading)
        tel = node.telemetry()
        assert tel.gpus[0].memory_used_gib == 20
        assert tel.gpus[0].utilization == 88
        # Someone else grabbed the card: admission must refuse with the live numbers.
        from lapis.agent.node import Refused

        with pytest.raises(Refused, match="roomiest GPU"):
            await node.start_model(spec("big", 8))

    async def test_started_runtime_knows_its_gpu(self):
        node = self._node(None)
        await node.start_model(spec("small", 1))
        assert node.models["small"].gpu_index == 1


def test_disk_free_is_measured(tmp_path):
    from lapis.agent.hardware import disk_free_gib

    assert disk_free_gib(str(tmp_path)) > 0
