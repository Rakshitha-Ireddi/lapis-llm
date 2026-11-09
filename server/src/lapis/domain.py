"""Shared domain types used by the master, the agents and the wire protocol."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .sizing import QUANT_BITS, estimate_memory_gib

MODEL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,63}$")
PUBLIC_KEY_RE = re.compile(r"^[0-9a-f]{64}$")


class RuntimeKind(StrEnum):
    LLAMA_CPP = "llama.cpp"
    VLLM = "vllm"
    MLX = "mlx"
    SIMULATED = "simulated"


class Platform(StrEnum):
    LINUX = "linux"
    WINDOWS = "windows"
    MACOS = "macos"


class NodeState(StrEnum):
    PENDING = "pending"
    ONLINE = "online"
    OFFLINE = "offline"
    DRAINING = "draining"
    REVOKED = "revoked"


class ModelState(StrEnum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    FAILED = "failed"


class Desired(StrEnum):
    RUNNING = "running"
    STOPPED = "stopped"


class Scope(StrEnum):
    INFERENCE = "inference"
    METRICS = "metrics"


# --------------------------------------------------------------------------- hardware


class GPU(BaseModel):
    index: int = 0
    name: str
    memory_total_gib: float = Field(gt=0)
    memory_used_gib: float = Field(default=0, ge=0)
    utilization: float = Field(default=0, ge=0, le=100)

    @property
    def memory_free_gib(self) -> float:
        return max(0.0, self.memory_total_gib - self.memory_used_gib)


class Telemetry(BaseModel):
    """What an agent reports on every heartbeat."""

    platform: Platform
    accelerator: str = ""
    unified_memory: bool = False
    memory_total_gib: float = Field(ge=0)
    memory_used_gib: float = Field(default=0, ge=0)
    gpus: list[GPU] = Field(default_factory=list)
    running: list[str] = Field(default_factory=list)
    tokens_per_second: float = 0
    requests_in_flight: int = 0
    disk_free_gib: float = 0

    @property
    def memory_free_gib(self) -> float:
        return max(0.0, self.memory_total_gib - self.memory_used_gib)


# --------------------------------------------------------------------------- models


class ModelSpec(BaseModel):
    """A model definition: what to run, with which runtime, and its memory budget."""

    name: str
    source: str = ""
    runtime: RuntimeKind = RuntimeKind.SIMULATED
    params_b: float = Field(gt=0, le=1000)
    quant: str = "q4"
    context: int = Field(default=8192, ge=256, le=1_048_576)
    parallel: int = Field(default=4, ge=1, le=256)
    memory_gib: float | None = Field(default=None, gt=0)
    #: Extra flags appended to the runtime command, e.g. ``["--pooling", "mean"]``.
    args: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        if not MODEL_NAME_RE.match(value):
            raise ValueError(
                "model name must be lowercase letters, digits, '.', '_', ':' or '-' (max 64)"
            )
        return value

    @field_validator("quant")
    @classmethod
    def _valid_quant(cls, value: str) -> str:
        if value not in QUANT_BITS:
            raise ValueError(f"quant must be one of {', '.join(QUANT_BITS)}")
        return value

    @property
    def budget_gib(self) -> float:
        if self.memory_gib is not None:
            return self.memory_gib
        return estimate_memory_gib(self.params_b, self.quant, self.context)


class Model(BaseModel):
    spec: ModelSpec
    node_id: str | None = None
    desired: Desired = Desired.STOPPED
    state: ModelState = ModelState.STOPPED
    last_error: str | None = None
    started_at: float | None = None
    requests: int = 0
    tokens: int = 0

    def view(self, node_name: str | None = None) -> dict[str, Any]:
        data = self.model_dump(mode="json")
        data["budget_gib"] = self.spec.budget_gib
        data["node_name"] = node_name
        return data


# --------------------------------------------------------------------------- nodes


class Node(BaseModel):
    model_config = ConfigDict(use_enum_values=False)

    id: str
    name: str
    url: str
    platform: Platform
    runtimes: list[RuntimeKind]
    public_key: str
    fingerprint: str
    state: NodeState = NodeState.PENDING
    created_at: float
    last_seen: float | None = None
    telemetry: Telemetry | None = None
    #: Shared secret issued on approval. Never returned by the admin API.
    secret: str | None = None

    def view(self, effective_state: NodeState) -> dict[str, Any]:
        data = self.model_dump(mode="json", exclude={"secret", "public_key"})
        data["state"] = effective_state.value
        return data


# --------------------------------------------------------------------------- wire


class EnrollRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    url: str = Field(pattern=r"^https?://")
    platform: Platform
    runtimes: list[RuntimeKind] = Field(min_length=1)
    public_key: str

    @field_validator("public_key")
    @classmethod
    def _valid_key(cls, value: str) -> str:
        if not PUBLIC_KEY_RE.match(value):
            raise ValueError("public_key must be 64 lowercase hex characters")
        return value


class EnrollResponse(BaseModel):
    node_id: str
    fingerprint: str
    state: NodeState


class ClaimRequest(BaseModel):
    identity: str = Field(min_length=16, max_length=256)


class ApproveRequest(BaseModel):
    fingerprint: str


class StartRequest(BaseModel):
    node_id: str | None = None


class MoveRequest(BaseModel):
    node_id: str


class LoginRequest(BaseModel):
    password: str


class ApiKey(BaseModel):
    id: str
    name: str
    prefix: str
    key_hash: str
    scopes: list[Scope]
    created_at: float
    last_used_at: float | None = None

    def view(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"key_hash"})


class CreateKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    scopes: list[Scope] = Field(default_factory=lambda: [Scope.INFERENCE], min_length=1)
