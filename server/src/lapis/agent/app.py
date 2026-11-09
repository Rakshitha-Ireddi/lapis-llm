"""The agent's HTTP API. Only the master (holding the node secret) may call it."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .. import __version__
from ..domain import ModelSpec
from .node import AgentNode, Refused
from .runtimes import Kind, RuntimeError_, UpstreamError


def create_agent_app(
    node: AgentNode,
    *,
    master_url: str | None = None,
    master_transport: httpx.AsyncBaseTransport | None = None,
    heartbeat_s: float = 5.0,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = None
        client = None
        if master_url:
            client = httpx.AsyncClient(base_url=master_url, transport=master_transport, timeout=15)
            task = asyncio.create_task(node.run(client, heartbeat_s))
        yield
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if client:
            await client.aclose()
        await node.stop_all()

    app = FastAPI(title=f"LapisLLM agent ({node.name})", version=__version__, lifespan=lifespan)
    app.state.node = node

    def require_master(x_lapis_token: str | None = Header(default=None)) -> None:
        if (
            not node.secret
            or not x_lapis_token
            or not secrets.compare_digest(node.secret, x_lapis_token)
        ):
            raise HTTPException(status_code=401, detail="missing or bad node token")

    guarded = [Depends(require_master)]

    @app.get("/agent/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "name": node.name,
            "approved": node.secret is not None,
            "fingerprint": node.fingerprint,
        }

    @app.get("/agent/telemetry", dependencies=guarded)
    async def telemetry() -> dict[str, Any]:
        return node.telemetry().model_dump(mode="json")

    @app.post("/agent/models/start", dependencies=guarded)
    async def start(spec: ModelSpec) -> dict[str, Any]:
        try:
            tel = await node.start_model(spec)
        except Refused as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"telemetry": tel.model_dump(mode="json")}

    @app.post("/agent/models/{name}/stop", dependencies=guarded)
    async def stop(name: str) -> dict[str, Any]:
        tel = await node.stop_model(name)
        return {"telemetry": tel.model_dump(mode="json")}

    async def serve(request: Request, kind: Kind) -> Response:
        body = await request.json()
        runtime = node.models.get(str(body.get("model", "")))
        if runtime is None:
            return JSONResponse(
                {"error": {"message": f"model {body.get('model')!r} is not running here"}},
                status_code=404,
            )
        try:
            result = await runtime.handle(kind, body)
        except UpstreamError as exc:
            return JSONResponse(exc.payload, status_code=exc.status)
        except RuntimeError_ as exc:
            return JSONResponse({"error": {"message": str(exc)}}, status_code=503)
        if isinstance(result, dict):
            return JSONResponse(result)
        return StreamingResponse(result, media_type="text/event-stream")

    @app.post("/v1/chat/completions", dependencies=guarded)
    async def chat(request: Request) -> Response:
        return await serve(request, "chat")

    @app.post("/v1/completions", dependencies=guarded)
    async def completions(request: Request) -> Response:
        return await serve(request, "completions")

    @app.post("/v1/embeddings", dependencies=guarded)
    async def embeddings(request: Request) -> Response:
        return await serve(request, "embeddings")

    return app
