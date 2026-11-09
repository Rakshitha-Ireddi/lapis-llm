"""The agent's view of its own machine, and its conversation with the master."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from pathlib import Path

import httpx

from .. import admission
from ..domain import GPU, ModelSpec, RuntimeKind, Telemetry
from ..security import fingerprint, new_identity, public_key_for
from .hardware import Hardware
from .runtimes import BaseRuntime, ProcessRuntime, RuntimeError_, SimulatedRuntime

log = logging.getLogger("lapis.agent")

RuntimeFactory = Callable[[ModelSpec, "AgentNode"], BaseRuntime]


class Refused(Exception):
    """The agent will not start this model (memory, runtime, ...)."""


def default_runtime_factory(spec: ModelSpec, node: AgentNode) -> BaseRuntime:
    if spec.runtime == RuntimeKind.SIMULATED:
        return SimulatedRuntime(spec, node.name, delay_s=node.stream_delay_s)
    gpu_util = None
    if spec.runtime == RuntimeKind.VLLM and node.hardware.gpus:
        total = max(g.memory_total_gib for g in node.hardware.gpus)
        gpu_util = min(0.95, spec.budget_gib / total)
    return ProcessRuntime(spec, gpu_memory_utilization=gpu_util)


class AgentNode:
    def __init__(
        self,
        *,
        name: str,
        url: str,
        hardware: Hardware,
        runtimes: list[RuntimeKind] | None = None,
        reserve_gib: float = 1.0,
        state_path: Path | None = None,
        runtime_factory: RuntimeFactory = default_runtime_factory,
        stream_delay_s: float = 0.0,
        live_gpus: Callable[[], list[GPU]] | None = None,
    ) -> None:
        self.name = name
        self.url = url
        self.hardware = hardware
        self.runtime_kinds = runtimes or hardware.default_runtimes()
        self.reserve_gib = reserve_gib
        self.state_path = state_path
        self.runtime_factory = runtime_factory
        self.stream_delay_s = stream_delay_s
        #: Real hardware: a live GPU reader (nvidia-smi). Presets: None (simulated usage).
        self.live_gpus = live_gpus
        self.models: dict[str, BaseRuntime] = {}
        self.gpu_of: dict[str, int | None] = {}
        self.node_id: str | None = None
        self.secret: str | None = None
        self.identity = new_identity()
        self._start_lock = asyncio.Lock()
        self._load_state()

    # ------------------------------------------------------------------ identity

    @property
    def public_key(self) -> str:
        return public_key_for(self.identity)

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.public_key)

    def _load_state(self) -> None:
        if self.state_path and self.state_path.exists():
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            self.identity = data.get("identity", self.identity)
            self.node_id = data.get("node_id")
            self.secret = data.get("secret")
        self._save_state()

    def _save_state(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            json.dumps({"identity": self.identity, "node_id": self.node_id, "secret": self.secret}),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------ telemetry

    def telemetry(self) -> Telemetry:
        hw = self.hardware
        tps = round(sum(rt.tokens_per_second for rt in self.models.values()), 1)
        in_flight = sum(rt.in_flight for rt in self.models.values())
        busy = min(97.0, 6 + in_flight * 22 + tps * 0.6) if self.models else 1.0
        if hw.gpus and not hw.unified_memory:
            gpus = []
            live = {g.index: g for g in self.live_gpus()} if self.live_gpus else {}
            for gpu in hw.gpus:
                reading = live.get(gpu.index)
                if reading is not None:
                    # Real usage already includes our models *and* everyone else's jobs.
                    used, util = reading.memory_used_gib, reading.utilization
                else:
                    used = gpu.memory_used_gib + sum(
                        self.models[n].spec.budget_gib
                        for n, idx in self.gpu_of.items()
                        if idx == gpu.index
                    )
                    util = busy
                gpus.append(
                    GPU(
                        index=gpu.index,
                        name=gpu.name,
                        memory_total_gib=gpu.memory_total_gib,
                        memory_used_gib=round(min(used, gpu.memory_total_gib), 2),
                        utilization=round(util, 1),
                    )
                )
            total = sum(g.memory_total_gib for g in gpus)
            used_total = sum(g.memory_used_gib for g in gpus)
        else:
            gpus = []
            total = hw.memory_total_gib
            used_total = hw.base_used_gib + sum(rt.spec.budget_gib for rt in self.models.values())
        return Telemetry(
            platform=hw.platform,
            accelerator=hw.accelerator,
            unified_memory=hw.unified_memory or not hw.gpus,
            memory_total_gib=round(total, 2),
            memory_used_gib=round(min(used_total, total), 2),
            gpus=gpus,
            running=sorted(self.models),
            tokens_per_second=tps,
            requests_in_flight=in_flight,
            disk_free_gib=hw.disk_free_gib,
        )

    # ------------------------------------------------------------------ models

    async def start_model(self, spec: ModelSpec) -> Telemetry:
        async with self._start_lock:
            if spec.name in self.models:
                return self.telemetry()
            adm = admission.check(
                spec.budget_gib,
                spec.runtime,
                self.runtime_kinds,
                self.telemetry(),
                self.reserve_gib,
            )
            if not adm.ok:
                raise Refused(adm.reason)
            runtime = self.runtime_factory(spec, self)
            runtime.gpu_index = adm.gpu_index
            try:
                await runtime.start()
            except RuntimeError_ as exc:
                raise Refused(str(exc)) from exc
            self.models[spec.name] = runtime
            self.gpu_of[spec.name] = adm.gpu_index
            log.info("started %s (%s)", spec.name, adm.reason)
            return self.telemetry()

    async def stop_model(self, name: str) -> Telemetry:
        runtime = self.models.pop(name, None)
        self.gpu_of.pop(name, None)
        if runtime is not None:
            await runtime.stop()
            log.info("stopped %s", name)
        return self.telemetry()

    async def stop_all(self) -> None:
        for name in list(self.models):
            await self.stop_model(name)

    # ------------------------------------------------------------------ master protocol

    async def enroll(self, master: httpx.AsyncClient) -> str:
        response = await master.post(
            "/api/enroll",
            json={
                "name": self.name,
                "url": self.url,
                "platform": self.hardware.platform.value,
                "runtimes": [r.value for r in self.runtime_kinds],
                "public_key": self.public_key,
            },
        )
        response.raise_for_status()
        self.node_id = response.json()["node_id"]
        self._save_state()
        return self.node_id

    async def claim(self, master: httpx.AsyncClient) -> bool:
        response = await master.post(
            f"/api/enroll/{self.node_id}/claim", json={"identity": self.identity}
        )
        if response.status_code == 202:
            return False
        response.raise_for_status()
        self.secret = response.json()["secret"]
        self._save_state()
        return True

    async def heartbeat(self, master: httpx.AsyncClient) -> int:
        response = await master.post(
            f"/api/nodes/{self.node_id}/heartbeat",
            json=self.telemetry().model_dump(mode="json"),
            headers={"X-Lapis-Token": self.secret or ""},
        )
        return response.status_code

    async def run(self, master: httpx.AsyncClient, interval_s: float = 5.0) -> None:
        """Enrol, wait for approval, then heartbeat forever."""
        announced = False
        while True:
            try:
                if not self.node_id:
                    await self.enroll(master)
                if not self.secret:
                    if not announced:
                        log.warning(
                            "Waiting for approval. Fingerprint for %s: %s",
                            self.name,
                            self.fingerprint,
                        )
                        announced = True
                    if not await self.claim(master):
                        await asyncio.sleep(min(interval_s, 2.0))
                        continue
                    log.info("approved as %s", self.node_id)
                try:
                    status = await self.heartbeat(master)
                except httpx.TransportError:
                    # A pooled keep-alive connection can be closed by the server at the
                    # same moment we reuse it. One immediate retry on a fresh request.
                    status = await self.heartbeat(master)
                if status == 404:
                    self.node_id, self.secret = None, None  # master forgot us: enrol again
                elif status == 403:
                    self.secret = None  # secret rotated (restore): re-claim with identity
            except httpx.HTTPError as exc:
                log.warning("master unreachable: %r", exc)
            await asyncio.sleep(interval_s)
