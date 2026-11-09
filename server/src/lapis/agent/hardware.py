"""Hardware detection and simulated presets."""

from __future__ import annotations

import platform as _platform
import shutil
import subprocess
import sys

from pydantic import BaseModel, Field

from ..domain import GPU, Platform, RuntimeKind


class Hardware(BaseModel):
    platform: Platform
    accelerator: str
    unified_memory: bool = False
    #: Pool size for unified-memory machines; ignored when ``gpus`` are present.
    memory_total_gib: float = 0
    #: Memory already used by the OS/desktop before any model starts.
    base_used_gib: float = 0
    gpus: list[GPU] = Field(default_factory=list)
    disk_free_gib: float = 500

    @property
    def pool_gib(self) -> float:
        if self.gpus and not self.unified_memory:
            return sum(g.memory_total_gib for g in self.gpus)
        return self.memory_total_gib

    def default_runtimes(self) -> list[RuntimeKind]:
        if self.platform == Platform.MACOS:
            return [RuntimeKind.LLAMA_CPP, RuntimeKind.MLX]
        if self.platform == Platform.LINUX:
            return [RuntimeKind.VLLM, RuntimeKind.LLAMA_CPP]
        return [RuntimeKind.LLAMA_CPP]


PRESETS: dict[str, Hardware] = {
    "gaming-pc": Hardware(
        platform=Platform.WINDOWS,
        accelerator="GeForce RTX 3070",
        gpus=[GPU(index=0, name="GeForce RTX 3070", memory_total_gib=8, memory_used_gib=0.6)],
        disk_free_gib=412,
    ),
    "gaming-pc-16": Hardware(
        platform=Platform.WINDOWS,
        accelerator="GeForce RTX 4070 Ti SUPER",
        gpus=[
            GPU(index=0, name="GeForce RTX 4070 Ti SUPER", memory_total_gib=16, memory_used_gib=0.8)
        ],
        disk_free_gib=780,
    ),
    "linux-box": Hardware(
        platform=Platform.LINUX,
        accelerator="GeForce RTX 3090",
        gpus=[GPU(index=0, name="GeForce RTX 3090", memory_total_gib=24, memory_used_gib=0.4)],
        disk_free_gib=1650,
    ),
    "macbook": Hardware(
        platform=Platform.MACOS,
        accelerator="Apple M3 Pro",
        unified_memory=True,
        memory_total_gib=36,
        base_used_gib=9,
        disk_free_gib=310,
    ),
    "spark": Hardware(
        platform=Platform.LINUX,
        accelerator="NVIDIA GB10",
        unified_memory=True,
        memory_total_gib=128,
        base_used_gib=6,
        disk_free_gib=3400,
    ),
}


def parse_nvidia_smi(output: str) -> list[GPU]:
    """Parse ``nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu
    --format=csv,noheader,nounits``."""
    gpus: list[GPU] = []
    for line in output.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 5:
            continue
        index, name, total, used, util = parts
        gpus.append(
            GPU(
                index=int(index),
                name=name,
                memory_total_gib=round(float(total) / 1024, 2),
                memory_used_gib=round(float(used) / 1024, 2),
                utilization=float(util) if util.replace(".", "").isdigit() else 0,
            )
        )
    return gpus


def current_platform() -> Platform:
    if sys.platform.startswith("win"):
        return Platform.WINDOWS
    if sys.platform == "darwin":
        return Platform.MACOS
    return Platform.LINUX


def disk_free_gib(path: str = ".") -> float:
    """Free space where the agent keeps its state and model downloads."""
    return round(shutil.disk_usage(path).free / 2**30, 1)


def select_gpus(gpus: list[GPU], allowed: set[int] | None) -> list[GPU]:
    """Keep only the GPUs this agent may use (``--gpus``) on a shared machine."""
    if allowed is None:
        return gpus
    return [g for g in gpus if g.index in allowed]


def query_nvidia_smi() -> list[GPU]:  # pragma: no cover - depends on the machine
    """Live reading of every NVIDIA GPU, including memory other processes use."""
    if not shutil.which("nvidia-smi"):
        return []
    query = "index,name,memory.total,memory.used,utilization.gpu"
    out = subprocess.run(
        ["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    ).stdout
    return parse_nvidia_smi(out)


def detect(allowed: set[int] | None = None) -> Hardware | None:  # pragma: no cover
    """Best-effort detection of the local accelerator. ``None`` if nothing usable."""
    plat = current_platform()
    if shutil.which("nvidia-smi"):
        gpus = select_gpus(query_nvidia_smi(), allowed)
        if gpus:
            return Hardware(
                platform=plat, accelerator=gpus[0].name, gpus=gpus, disk_free_gib=disk_free_gib()
            )
    if plat == Platform.MACOS and _platform.machine() == "arm64":
        out = subprocess.run(
            ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, check=False
        ).stdout
        total = int(out.strip() or 0) / 2**30
        if total:
            return Hardware(
                platform=plat,
                accelerator="Apple Silicon",
                unified_memory=True,
                memory_total_gib=round(total, 1),
                base_used_gib=round(total * 0.25, 1),
                disk_free_gib=disk_free_gib(),
            )
    return None
