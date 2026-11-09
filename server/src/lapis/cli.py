"""``lapis`` command line: run a master, an agent, the demo fleet, or size a model."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import random
import socket
import sys
from pathlib import Path

import httpx
import uvicorn

from . import __version__
from .agent.app import create_agent_app
from .agent.hardware import PRESETS, Hardware, detect, query_nvidia_smi
from .agent.node import AgentNode
from .config import Settings
from .domain import ModelSpec, NodeState, RuntimeKind
from .master.app import create_master_app
from .master.fleet import Fleet, FleetError
from .sizing import estimate_memory_gib, suggest_quant, verdict

log = logging.getLogger("lapis")

DEMO_FLEET = [
    ("gaming-pc", "gaming-pc"),
    ("studio-pc", "gaming-pc-16"),
    ("linux-box", "linux-box"),
    ("macbook-pro", "macbook"),
    ("spark", "spark"),
]

DEMO_MODELS = [
    ModelSpec(
        name="llama-3.1-8b-instruct",
        source="bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        params_b=8,
        quant="q4",
        context=8192,
    ),
    ModelSpec(
        name="qwen2.5-coder-14b",
        source="Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
        params_b=14.7,
        quant="q4",
        context=16384,
    ),
    ModelSpec(
        name="qwen2.5-32b-instruct",
        source="Qwen/Qwen2.5-32B-Instruct-AWQ",
        params_b=32.5,
        quant="q4",
        context=8192,
    ),
    ModelSpec(
        name="gemma-2-9b-it", source="google/gemma-2-9b-it", params_b=9.2, quant="q5", context=8192
    ),
    ModelSpec(
        name="llama-3.3-70b-instruct",
        source="meta-llama/Llama-3.3-70B-Instruct",
        params_b=70.6,
        quant="q4",
        context=16384,
    ),
    ModelSpec(
        name="nomic-embed-text",
        source="nomic-ai/nomic-embed-text-v1.5",
        params_b=0.14,
        quant="fp16",
        context=2048,
    ),
    ModelSpec(
        name="mistral-small-24b",
        source="mistralai/Mistral-Small-24B-Instruct-2501",
        params_b=23.6,
        quant="q4",
        context=8192,
    ),
]

DEMO_RUNNING = [
    "llama-3.3-70b-instruct",
    "qwen2.5-32b-instruct",
    "qwen2.5-coder-14b",
    "gemma-2-9b-it",
    "llama-3.1-8b-instruct",
    "nomic-embed-text",
]


def _port_free(port: int) -> bool:
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _server(app, port: int, host: str = "127.0.0.1") -> uvicorn.Server:
    config = uvicorn.Config(app, host=host, port=port, log_level="warning", lifespan="on")
    return uvicorn.Server(config)


# --------------------------------------------------------------------------- commands


def cmd_master(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    if args.data_dir:
        settings.data_dir = Path(args.data_dir)
    if args.web_dir:
        settings.web_dir = Path(args.web_dir)
    uvicorn.run(create_master_app(settings), host=args.host, port=args.port, log_level="info")
    return 0


def _allowed_gpus(args: argparse.Namespace) -> set[int] | None:
    if not args.gpus:
        return None
    return {int(x) for x in args.gpus.split(",") if x.strip()}


def _hardware(args: argparse.Namespace) -> Hardware:
    if args.preset:
        return PRESETS[args.preset].model_copy(deep=True)
    found = detect(_allowed_gpus(args))
    if found is None:
        print(
            "No supported accelerator found. Use --preset to run a simulated node.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return found


def cmd_agent(args: argparse.Namespace) -> int:
    hardware = _hardware(args)
    runtimes = [RuntimeKind(r) for r in args.runtime] if args.runtime else None
    if args.preset and not runtimes:
        runtimes = [RuntimeKind.SIMULATED]
    url = args.advertise_url or f"http://{socket.gethostname()}:{args.port}"
    node = AgentNode(
        name=args.name or socket.gethostname().lower(),
        url=url,
        hardware=hardware,
        runtimes=runtimes,
        reserve_gib=args.reserve,
        state_path=Path(args.state_dir) / "agent.json",
        stream_delay_s=0.02 if args.preset else 0.0,
        live_gpus=None if args.preset else query_nvidia_smi,
    )
    print(f"LapisLLM agent {node.name}")
    print(f"  fingerprint: {node.fingerprint}")
    print(f"  master:      {args.master}")
    print("  Approve this fingerprint on the Nodes page of the console.")
    app = create_agent_app(node, master_url=args.master)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_estimate(args: argparse.Namespace) -> int:
    needed = estimate_memory_gib(args.params, args.quant, args.context)
    print(f"{args.params}B @ {args.quant}, {args.context} tokens of context -> {needed:.2f} GiB")
    if args.memory:
        print(f"On {args.memory:g} GiB: {verdict(needed, args.memory)}")
        best = suggest_quant(args.params, args.context, args.memory)
        print(f"Best comfortable quantisation: {best or 'none - pick a smaller model'}")
    return 0


async def _seed_demo(fleet: Fleet, traffic: bool, master_port: int) -> None:
    for _ in range(100):
        online = [
            n
            for n in fleet.nodes.values()
            if fleet.effective_state(n) == NodeState.ONLINE and n.telemetry is not None
        ]
        if len(online) == len(DEMO_FLEET):
            break
        await asyncio.sleep(0.2)
    for spec in DEMO_MODELS:
        if spec.name not in fleet.models:
            fleet.add_model(spec, actor="demo")
    for name in DEMO_RUNNING:
        with contextlib.suppress(FleetError):
            await fleet.start_model(name, actor="demo")
    if not traffic:
        return
    key = next((k for k in fleet.keys.values() if k.name == "demo-traffic"), None)
    if key:
        fleet.revoke_key(key.id, actor="demo")
    _, plaintext = fleet.create_key("demo-traffic", ["inference"], actor="demo")  # type: ignore[list-item]
    prompts = [
        "Summarise the plan for the sprint.",
        "Write a haiku about spare GPUs.",
        "Explain admission control in one paragraph.",
        "Refactor this function to be async.",
        "What is grouped-query attention?",
    ]
    async with httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{master_port}",
        headers={"Authorization": f"Bearer {plaintext}"},
        timeout=60,
    ) as client:
        while True:
            chat_models = [n for n in DEMO_RUNNING if n != "nomic-embed-text"]
            model = random.choice(chat_models)
            with contextlib.suppress(httpx.HTTPError):
                await client.post(
                    "/v1/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": random.choice(prompts)}],
                        "max_tokens": random.randint(40, 120),
                    },
                )
            await asyncio.sleep(random.uniform(0.15, 0.6))


async def _run_demo(args: argparse.Namespace) -> None:
    ports = [args.port] + [args.agent_port + i for i in range(len(DEMO_FLEET))]
    busy = [p for p in ports if not _port_free(p)]
    if busy:
        raise SystemExit(f"ports already in use: {busy}")

    settings = Settings(
        data_dir=None,
        admin_password=args.password,
        require_api_key=True,
        auto_approve=True,
        heartbeat_timeout_s=15,
        web_dir=Path(args.web_dir) if args.web_dir else None,
        cors_origins=["*"],
    )
    fleet = Fleet(settings)
    servers = [_server(create_master_app(settings, fleet=fleet), args.port, args.host)]
    master_url = f"http://127.0.0.1:{args.port}"
    for i, (name, preset) in enumerate(DEMO_FLEET):
        port = args.agent_port + i
        node = AgentNode(
            name=name,
            url=f"http://127.0.0.1:{port}",
            hardware=PRESETS[preset].model_copy(deep=True),
            runtimes=[RuntimeKind.SIMULATED],
            stream_delay_s=0.03,
        )
        app = create_agent_app(node, master_url=master_url, heartbeat_s=2.0)
        servers.append(_server(app, port))

    print(f"LapisLLM {__version__} demo fleet")
    print(f"  console:  http://localhost:{args.port}/console.html")
    print(f"  password: {args.password}")
    print(f"  API:      http://localhost:{args.port}/v1  (create a key on the Access page)")
    print("  Ctrl+C to stop.")
    tasks = [asyncio.create_task(s.serve()) for s in servers]
    tasks.append(asyncio.create_task(_seed_demo(fleet, args.traffic, args.port)))
    await asyncio.gather(*tasks)


def cmd_demo(args: argparse.Namespace) -> int:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_run_demo(args))
    return 0


# --------------------------------------------------------------------------- parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lapis", description=__doc__)
    parser.add_argument("--version", action="version", version=f"lapis {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    master = sub.add_parser("master", help="run the control plane")
    master.add_argument("--host", default="0.0.0.0")
    master.add_argument("--port", type=int, default=8080)
    master.add_argument("--data-dir")
    master.add_argument("--web-dir", help="serve the built console from this folder")
    master.set_defaults(func=cmd_master)

    agent = sub.add_parser("agent", help="run a node agent on this machine")
    agent.add_argument("--master", required=True, help="e.g. http://192.168.1.10:8080")
    agent.add_argument("--name")
    agent.add_argument("--host", default="0.0.0.0")
    agent.add_argument("--port", type=int, default=8101)
    agent.add_argument("--advertise-url", help="URL the master should use to reach this agent")
    agent.add_argument("--preset", choices=sorted(PRESETS), help="simulate this hardware")
    agent.add_argument("--runtime", action="append", choices=[r.value for r in RuntimeKind])
    agent.add_argument(
        "--gpus", help="comma-separated GPU indices this agent may use, e.g. 1 or 0,2"
    )
    agent.add_argument("--reserve", type=float, default=1.0, help="GiB kept free (default 1)")
    agent.add_argument("--state-dir", default=".lapis-agent")
    agent.set_defaults(func=cmd_agent)

    demo = sub.add_parser("demo", help="run a master and five simulated nodes locally")
    demo.add_argument("--host", default="127.0.0.1")
    demo.add_argument("--port", type=int, default=8080)
    demo.add_argument("--agent-port", type=int, default=8101)
    demo.add_argument("--password", default="lapis-demo")
    demo.add_argument("--web-dir", help="serve the built console (web/dist)")
    demo.add_argument("--no-traffic", dest="traffic", action="store_false")
    demo.set_defaults(func=cmd_demo)

    est = sub.add_parser("estimate", help="estimate the memory a model needs")
    est.add_argument("--params", type=float, required=True, help="billions of parameters")
    est.add_argument("--quant", default="q4", choices=["q4", "q5", "q6", "q8", "fp16"])
    est.add_argument("--context", type=int, default=8192)
    est.add_argument("--memory", type=float, help="GPU or unified memory in GiB")
    est.set_defaults(func=cmd_estimate)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
