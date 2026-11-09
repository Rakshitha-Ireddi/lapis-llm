from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest

from lapis.agent.app import create_agent_app
from lapis.agent.hardware import PRESETS
from lapis.agent.node import AgentNode
from lapis.config import Settings
from lapis.domain import ModelSpec, RuntimeKind
from lapis.master.agent_client import AgentClient
from lapis.master.app import create_master_app
from lapis.master.fleet import Fleet

ROOT = Path(__file__).resolve().parents[2]
ADMIN_PASSWORD = "correct-horse"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def sizing_cases() -> dict[str, Any]:
    return json.loads((ROOT / "shared" / "sizing-cases.json").read_text(encoding="utf-8"))


class FakeClock:
    def __init__(self, start: float = 1_700_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def spec(name: str = "llama-8b", params_b: float = 8, **kw: Any) -> ModelSpec:
    return ModelSpec(name=name, params_b=params_b, **kw)


@dataclass
class Harness:
    """A master and any number of in-process agents wired together with ASGI transports."""

    fleet: Fleet
    master_app: Any
    clock: FakeClock
    agent_apps: dict[str, Any] = field(default_factory=dict)
    agents: dict[str, AgentNode] = field(default_factory=dict)

    def master(self, **headers: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.master_app),
            base_url="http://master",
            headers=headers,
        )

    def add_agent(self, name: str, preset: str = "gaming-pc", **kw: Any) -> AgentNode:
        url = f"http://{name}.lan:8101"
        node = AgentNode(
            name=name,
            url=url,
            hardware=PRESETS[preset].model_copy(deep=True),
            runtimes=kw.pop("runtimes", [RuntimeKind.SIMULATED]),
            **kw,
        )
        self.agents[name] = node
        self.agent_apps[url] = create_agent_app(node)
        return node

    async def join(self, name: str, preset: str = "gaming-pc", **kw: Any) -> AgentNode:
        node = self.add_agent(name, preset, **kw)
        async with self.master() as master:
            await node.enroll(master)
            self.fleet.approve(node.node_id, node.fingerprint)
            assert await node.claim(master)
            assert await node.heartbeat(master) == 200
        return node

    async def heartbeat(self, name: str) -> int:
        async with self.master() as master:
            return await self.agents[name].heartbeat(master)

    async def admin_token(self) -> str:
        async with self.master() as master:
            response = await master.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
            return response.json()["token"]


@pytest.fixture
def settings() -> Settings:
    return Settings(admin_password=ADMIN_PASSWORD, session_secret="s" * 64, memory_reserve_gib=1.0)


@pytest.fixture
async def harness(settings: Settings, clock: FakeClock) -> AsyncIterator[Harness]:
    apps: dict[str, Any] = {}
    agents = AgentClient(transport_factory=lambda url: httpx.ASGITransport(app=apps[url]))
    fleet = Fleet(settings, agents=agents, clock=clock)
    h = Harness(fleet=fleet, master_app=create_master_app(settings, fleet=fleet), clock=clock)
    h.agent_apps = apps
    yield h
    await agents.aclose()
