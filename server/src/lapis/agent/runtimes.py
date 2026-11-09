"""Model runtimes.

* :class:`SimulatedRuntime` produces OpenAI-shaped responses without a GPU. It powers
  the demo fleet, the test-suite and the screenshots.
* :class:`ProcessRuntime` launches a real inference server (llama.cpp, vLLM, MLX)
  as a child process on a local port and proxies requests to it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import shutil
import socket
import time
import uuid
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx

from ..domain import ModelSpec, RuntimeKind

Kind = Literal["chat", "completions", "embeddings"]
Result = dict[str, Any] | AsyncIterator[bytes]


class RuntimeError_(Exception):
    """A runtime failed to start or serve."""


class UpstreamError(Exception):
    """The runtime answered with an HTTP error; relay its status and body unchanged."""

    def __init__(self, status: int, payload: Any) -> None:
        super().__init__(f"upstream returned {status}")
        self.status = status
        self.payload = payload


def wants_embeddings(spec: ModelSpec) -> bool:
    """Embedding models need llama-server's ``--embeddings`` switch."""
    return "embed" in f"{spec.name} {spec.source}".lower()


class TokenRate:
    """Rolling tokens-per-second over a short window."""

    def __init__(self, window_s: float = 10.0, clock=time.monotonic) -> None:
        self._events: deque[tuple[float, int]] = deque()
        self._window = window_s
        self._clock = clock

    def add(self, tokens: int) -> None:
        self._events.append((self._clock(), tokens))

    def value(self) -> float:
        now = self._clock()
        while self._events and now - self._events[0][0] > self._window:
            self._events.popleft()
        return round(sum(t for _, t in self._events) / self._window, 1)


class BaseRuntime(ABC):
    def __init__(self, spec: ModelSpec) -> None:
        self.spec = spec
        self.in_flight = 0
        #: The GPU admission chose; process runtimes are pinned to it.
        self.gpu_index: int | None = None
        self.rate = TokenRate()

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def handle(self, kind: Kind, body: dict[str, Any]) -> Result: ...

    @property
    def tokens_per_second(self) -> float:
        return self.rate.value()


# --------------------------------------------------------------------------- simulated

_SENTENCES = [
    "LapisLLM routed this request to the machine that serves the model you asked for.",
    "Every node checks its free memory before it agrees to start a model.",
    "Clients only ever see one base URL, no matter how many machines are behind it.",
    "Spare gaming PCs, old laptops and Apple Silicon Macs all count as capacity.",
    "Admission refuses a start with a plain-language reason instead of crashing later.",
    "Placement packs small models onto small machines so the big ones stay free.",
    "Streaming responses are relayed chunk by chunk from the agent to your client.",
    "Stopped models stay stopped after a reboot, running ones come back one at a time.",
    "API keys are scoped, hashed at rest and shown exactly once when created.",
    "This reply is simulated, so the demo fleet runs on a laptop without a GPU.",
]


def _seed(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")


def _prompt_of(kind: Kind, body: dict[str, Any]) -> str:
    if kind == "chat":
        messages = body.get("messages") or []
        if messages and isinstance(messages[-1], dict):
            content = messages[-1].get("content", "")
            return content if isinstance(content, str) else json.dumps(content)
        return ""
    prompt = body.get("prompt") or body.get("input") or ""
    return prompt if isinstance(prompt, str) else json.dumps(prompt)


def _approx_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


class SimulatedRuntime(BaseRuntime):
    """A deterministic fake model. Same prompt in, same answer out."""

    def __init__(self, spec: ModelSpec, node_name: str = "node", delay_s: float = 0.0) -> None:
        super().__init__(spec)
        self.node_name = node_name
        self.delay_s = delay_s
        self.running = False

    @property
    def nominal_tps(self) -> float:
        return round(600 / (self.spec.params_b + 1.5), 1)

    async def start(self) -> None:
        self.running = True

    async def stop(self) -> None:
        self.running = False

    def reply(self, prompt: str, max_tokens: int = 96) -> str:
        seed = _seed(prompt + self.spec.name)
        opening = f"Hi from {self.spec.name} on {self.node_name}."
        picked = [_SENTENCES[(seed + i * 7) % len(_SENTENCES)] for i in range(3)]
        words = (opening + " " + " ".join(dict.fromkeys(picked))).split()
        return " ".join(words[: max(1, max_tokens)])

    def embed(self, text: str, dims: int = 256) -> list[float]:
        values: list[float] = []
        counter = 0
        while len(values) < dims:
            digest = hashlib.sha256(f"{self.spec.name}:{text}:{counter}".encode()).digest()
            values.extend((b - 127.5) / 127.5 for b in digest)
            counter += 1
        values = values[:dims]
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [round(v / norm, 6) for v in values]

    async def handle(self, kind: Kind, body: dict[str, Any]) -> Result:
        if not self.running:
            raise RuntimeError_(f"{self.spec.name} is not running")
        if kind == "embeddings":
            return self._embeddings(body)
        prompt = _prompt_of(kind, body)
        max_tokens = int(body.get("max_tokens") or body.get("max_completion_tokens") or 96)
        text = self.reply(prompt, max_tokens)
        usage = {
            "prompt_tokens": _approx_tokens(prompt),
            "completion_tokens": len(text.split()),
        }
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        if body.get("stream"):
            return self._stream(kind, text, usage)
        self.rate.add(usage["completion_tokens"])
        rid, created = f"lapis-{uuid.uuid4().hex[:12]}", int(time.time())
        if kind == "chat":
            return {
                "id": rid,
                "object": "chat.completion",
                "created": created,
                "model": self.spec.name,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
                "usage": usage,
            }
        return {
            "id": rid,
            "object": "text_completion",
            "created": created,
            "model": self.spec.name,
            "choices": [{"index": 0, "text": text, "finish_reason": "stop"}],
            "usage": usage,
        }

    def _embeddings(self, body: dict[str, Any]) -> dict[str, Any]:
        raw = body.get("input", "")
        inputs = raw if isinstance(raw, list) else [raw]
        data = [
            {"object": "embedding", "index": i, "embedding": self.embed(str(text))}
            for i, text in enumerate(inputs)
        ]
        tokens = sum(_approx_tokens(str(t)) for t in inputs)
        return {
            "object": "list",
            "model": self.spec.name,
            "data": data,
            "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
        }

    async def _stream(self, kind: Kind, text: str, usage: dict[str, int]) -> AsyncIterator[bytes]:
        rid, created = f"lapis-{uuid.uuid4().hex[:12]}", int(time.time())
        self.in_flight += 1
        try:
            words = text.split()
            for i, word in enumerate(words):
                piece = word if i == 0 else " " + word
                if kind == "chat":
                    delta: dict[str, Any] = {"content": piece}
                    if i == 0:
                        delta["role"] = "assistant"
                    choice: dict[str, Any] = {"index": 0, "delta": delta, "finish_reason": None}
                    obj = "chat.completion.chunk"
                else:
                    choice = {"index": 0, "text": piece, "finish_reason": None}
                    obj = "text_completion"
                chunk = {
                    "id": rid,
                    "object": obj,
                    "created": created,
                    "model": self.spec.name,
                    "choices": [choice],
                }
                self.rate.add(1)
                yield f"data: {json.dumps(chunk)}\n\n".encode()
                if self.delay_s:
                    await asyncio.sleep(self.delay_s)
            final = {
                "id": rid,
                "object": "chat.completion.chunk" if kind == "chat" else "text_completion",
                "created": created,
                "model": self.spec.name,
                "choices": [
                    {"index": 0, "delta": {}, "finish_reason": "stop"}
                    if kind == "chat"
                    else {"index": 0, "text": "", "finish_reason": "stop"}
                ],
                "usage": usage,
            }
            yield f"data: {json.dumps(final)}\n\n".encode()
            yield b"data: [DONE]\n\n"
        finally:
            self.in_flight -= 1


# --------------------------------------------------------------------------- real runtimes

BINARIES = {
    RuntimeKind.LLAMA_CPP: ("LAPIS_LLAMA_SERVER", "llama-server"),
    RuntimeKind.VLLM: ("LAPIS_VLLM", "vllm"),
    RuntimeKind.MLX: ("LAPIS_MLX_SERVER", "mlx_lm.server"),
}


def binary_for(kind: RuntimeKind) -> str:
    env, default = BINARIES[kind]
    return os.environ.get(env, default)


def build_command(
    spec: ModelSpec, port: int, *, gpu_memory_utilization: float | None = None
) -> list[str]:
    """The exact command line used to launch a runtime for ``spec``."""
    if spec.runtime == RuntimeKind.LLAMA_CPP:
        source = ["-m", spec.source] if spec.source.endswith(".gguf") else ["-hf", spec.source]
        return [
            binary_for(spec.runtime),
            *source,
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--alias",
            spec.name,
            "-c",
            str(spec.context * spec.parallel),
            "--parallel",
            str(spec.parallel),
            "-ngl",
            "999",
            *(["--embeddings"] if wants_embeddings(spec) else []),
            *spec.args,
        ]
    if spec.runtime == RuntimeKind.VLLM:
        cmd = [
            binary_for(spec.runtime),
            "serve",
            spec.source,
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--served-model-name",
            spec.name,
            "--max-model-len",
            str(spec.context),
            "--max-num-seqs",
            str(spec.parallel),
        ]
        if gpu_memory_utilization:
            cmd += ["--gpu-memory-utilization", f"{gpu_memory_utilization:.2f}"]
        return [*cmd, *spec.args]
    if spec.runtime == RuntimeKind.MLX:
        return [
            binary_for(spec.runtime),
            "--model",
            spec.source,
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            *spec.args,
        ]
    raise ValueError(f"{spec.runtime.value} is not a process runtime")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def child_env(gpu_index: int | None, base: dict[str, str] | None = None) -> dict[str, str]:
    """Environment for a runtime process, pinned to one GPU when admission chose one.

    Without this, llama.cpp with ``-ngl 999`` spreads layers over *every* visible GPU,
    including cards other people are using on a shared machine.
    """
    env = dict(os.environ if base is None else base)
    if gpu_index is not None:
        env["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"  # match nvidia-smi numbering
        env["CUDA_VISIBLE_DEVICES"] = str(gpu_index)
    return env


def _json_or_text(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {"error": {"message": response.text or f"HTTP {response.status_code}"}}


UPSTREAM_PATHS: dict[Kind, str] = {
    "chat": "/v1/chat/completions",
    "completions": "/v1/completions",
    "embeddings": "/v1/embeddings",
}


class ProcessRuntime(BaseRuntime):  # pragma: no cover - needs real runtimes installed
    """Run llama.cpp / vLLM / MLX as a child process and proxy to it."""

    def __init__(
        self,
        spec: ModelSpec,
        *,
        gpu_memory_utilization: float | None = None,
        ready_timeout_s: float = 900.0,
    ) -> None:
        super().__init__(spec)
        self.port = free_port()
        self.command = build_command(spec, self.port, gpu_memory_utilization=gpu_memory_utilization)
        self.ready_timeout_s = ready_timeout_s
        self.process: asyncio.subprocess.Process | None = None
        self.client = httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{self.port}", timeout=httpx.Timeout(10, read=600)
        )

    async def start(self) -> None:
        if shutil.which(self.command[0]) is None:
            raise RuntimeError_(f"{self.command[0]} is not installed on this node")
        self.process = await asyncio.create_subprocess_exec(
            *self.command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=child_env(self.gpu_index),
        )
        deadline = time.monotonic() + self.ready_timeout_s
        while time.monotonic() < deadline:
            if self.process.returncode is not None:
                raise RuntimeError_(f"{self.command[0]} exited with {self.process.returncode}")
            try:
                if (await self.client.get("/v1/models")).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(1)
        await self.stop()
        raise RuntimeError_(f"{self.spec.name} did not become ready in time")

    async def stop(self) -> None:
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=20)
            except TimeoutError:
                self.process.kill()
        await self.client.aclose()

    async def handle(self, kind: Kind, body: dict[str, Any]) -> Result:
        path = UPSTREAM_PATHS[kind]
        if body.get("stream"):
            request = self.client.build_request("POST", path, json=body)
            response = await self.client.send(request, stream=True)
            if response.is_error:
                await response.aread()
                await response.aclose()
                raise UpstreamError(response.status_code, _json_or_text(response))

            async def relay() -> AsyncIterator[bytes]:
                self.in_flight += 1
                try:
                    async for chunk in response.aiter_raw():
                        self.rate.add(chunk.count(b"data:"))
                        yield chunk
                finally:
                    self.in_flight -= 1
                    await response.aclose()

            return relay()
        response = await self.client.post(path, json=body)
        payload = _json_or_text(response)
        if response.is_error:
            raise UpstreamError(response.status_code, payload)
        usage = payload.get("usage") or {}
        self.rate.add(int(usage.get("completion_tokens", 0)))
        return payload
