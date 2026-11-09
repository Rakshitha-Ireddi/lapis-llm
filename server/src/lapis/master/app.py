"""The master HTTP app: admin API, enrolment, the /v1 router, metrics and the console."""

from __future__ import annotations

import hmac
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..config import Settings
from ..domain import (
    ApproveRequest,
    ClaimRequest,
    CreateKeyRequest,
    EnrollRequest,
    EnrollResponse,
    LoginRequest,
    ModelSpec,
    MoveRequest,
    Scope,
    StartRequest,
    Telemetry,
)
from ..security import SessionSigner
from .agent_client import TOKEN_HEADER
from .fleet import Fleet, FleetError, Forbidden

log = logging.getLogger("lapis.master")

INFERENCE_PATHS = {
    "chat/completions": "/v1/chat/completions",
    "completions": "/v1/completions",
    "embeddings": "/v1/embeddings",
}


def _error(status: int, message: str, kind: str = "invalid_request_error") -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": kind}}, status_code=status)


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _usage_from_sse(tail: bytes) -> int:
    """Find ``usage.total_tokens`` in the last data events of an SSE stream."""
    for line in reversed(tail.decode("utf-8", "ignore").splitlines()):
        if not line.startswith("data:") or "[DONE]" in line:
            continue
        try:
            usage = json.loads(line[5:].strip()).get("usage") or {}
        except ValueError:
            continue
        if usage:
            return int(usage.get("total_tokens", 0))
    return 0


def create_master_app(settings: Settings | None = None, *, fleet: Fleet | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    fleet = fleet or Fleet(settings)
    signer = SessionSigner(settings.session_secret)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.password_generated:
            log.warning("No LAPIS_ADMIN_PASSWORD set. Generated one: %s", settings.admin_password)
        yield
        await fleet.agents.aclose()

    app = FastAPI(
        title="LapisLLM",
        version=__version__,
        description="Pool the spare machines you own behind one OpenAI-compatible endpoint.",
        lifespan=lifespan,
    )
    app.state.fleet = fleet
    app.state.settings = settings

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Lapis-Node"],
        )

    @app.exception_handler(FleetError)
    async def _fleet_error(_: Request, exc: FleetError) -> JSONResponse:
        return _error(exc.status, exc.message, exc.kind)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return _error(422, f"{where}: {first.get('msg', 'invalid request')}".strip(": "))

    # ------------------------------------------------------------------ auth deps

    def require_admin(authorization: str | None = Header(default=None)) -> str:
        if not signer.verify(_bearer(authorization)):
            raise Forbidden("admin login required")
        return "admin"

    def scope_guard(scope: Scope):
        def guard(authorization: str | None = Header(default=None)) -> str:
            if not settings.require_api_key:
                return "anonymous"
            token = _bearer(authorization)
            if signer.verify(token):
                return "admin"
            key = fleet.check_key(token, scope)
            if key is None:
                raise Forbidden(f"a valid API key with the '{scope.value}' scope is required")
            return f"key:{key.name}"

        return guard

    # ------------------------------------------------------------------ public

    @app.get("/healthz", tags=["system"])
    async def healthz() -> dict[str, Any]:
        return {"status": "ok", "service": "lapis-master", "version": __version__}

    @app.post("/api/auth/login", tags=["admin"])
    async def login(body: LoginRequest) -> dict[str, Any]:
        if not hmac.compare_digest(body.password, settings.admin_password):
            fleet.audit.record("anonymous", "auth.login.failed")
            raise Forbidden("wrong password")
        fleet.audit.record("admin", "auth.login")
        return {"token": signer.issue(), "require_api_key": settings.require_api_key}

    # ------------------------------------------------------------------ enrolment (agents)

    @app.post("/api/enroll", tags=["agents"], response_model=EnrollResponse)
    async def enroll(body: EnrollRequest) -> EnrollResponse:
        node = fleet.enroll(body)
        return EnrollResponse(node_id=node.id, fingerprint=node.fingerprint, state=node.state)

    @app.post("/api/enroll/{node_id}/claim", tags=["agents"])
    async def claim(node_id: str, body: ClaimRequest) -> Response:
        secret = fleet.claim(node_id, body.identity)
        if secret is None:
            return JSONResponse({"state": "pending"}, status_code=202)
        return JSONResponse({"state": "approved", "secret": secret})

    @app.post("/api/nodes/{node_id}/heartbeat", tags=["agents"])
    async def heartbeat(
        node_id: str,
        body: Telemetry,
        x_lapis_token: str | None = Header(default=None, alias=TOKEN_HEADER),
    ) -> dict[str, Any]:
        node = await fleet.heartbeat(node_id, x_lapis_token, body)
        return {"state": fleet.effective_state(node).value}

    # ------------------------------------------------------------------ admin api

    admin = [Depends(require_admin)]

    @app.get("/api/overview", tags=["admin"], dependencies=admin)
    async def overview() -> dict[str, Any]:
        return fleet.overview()

    @app.get("/api/nodes", tags=["admin"], dependencies=admin)
    async def list_nodes() -> list[dict[str, Any]]:
        return [fleet.node_view(n) for n in fleet.nodes.values()]

    @app.post("/api/nodes/{node_id}/approve", tags=["admin"], dependencies=admin)
    async def approve(node_id: str, body: ApproveRequest) -> dict[str, Any]:
        return fleet.node_view(fleet.approve(node_id, body.fingerprint))

    @app.post("/api/nodes/{node_id}/drain", tags=["admin"], dependencies=admin)
    async def drain(node_id: str) -> dict[str, Any]:
        return fleet.node_view(fleet.drain(node_id))

    @app.post("/api/nodes/{node_id}/undrain", tags=["admin"], dependencies=admin)
    async def undrain(node_id: str) -> dict[str, Any]:
        return fleet.node_view(fleet.undrain(node_id))

    @app.post("/api/nodes/{node_id}/revoke", tags=["admin"], dependencies=admin)
    async def revoke(node_id: str) -> dict[str, Any]:
        return fleet.node_view(fleet.revoke(node_id))

    @app.delete("/api/nodes/{node_id}", tags=["admin"], dependencies=admin, status_code=204)
    async def remove_node(node_id: str) -> Response:
        fleet.remove_node(node_id)
        return Response(status_code=204)

    @app.get("/api/models", tags=["admin"], dependencies=admin)
    async def list_models() -> list[dict[str, Any]]:
        return [fleet.model_view(m) for m in fleet.models.values()]

    @app.post("/api/models", tags=["admin"], dependencies=admin, status_code=201)
    async def add_model(spec: ModelSpec) -> dict[str, Any]:
        return fleet.model_view(fleet.add_model(spec))

    @app.post("/api/models/preview", tags=["admin"], dependencies=admin)
    async def preview(spec: ModelSpec) -> dict[str, Any]:
        return {"budget_gib": spec.budget_gib, "nodes": fleet.preview(spec)}

    @app.delete("/api/models/{name}", tags=["admin"], dependencies=admin, status_code=204)
    async def remove_model(name: str) -> Response:
        fleet.remove_model(name)
        return Response(status_code=204)

    @app.post("/api/models/{name}/start", tags=["admin"], dependencies=admin)
    async def start_model(name: str, body: StartRequest | None = None) -> dict[str, Any]:
        model = await fleet.start_model(name, body.node_id if body else None)
        return fleet.model_view(model)

    @app.post("/api/models/{name}/stop", tags=["admin"], dependencies=admin)
    async def stop_model(name: str) -> dict[str, Any]:
        return fleet.model_view(await fleet.stop_model(name))

    @app.post("/api/models/{name}/move", tags=["admin"], dependencies=admin)
    async def move_model(name: str, body: MoveRequest) -> dict[str, Any]:
        return fleet.model_view(await fleet.move_model(name, body.node_id))

    @app.get("/api/keys", tags=["admin"], dependencies=admin)
    async def list_keys() -> list[dict[str, Any]]:
        return [k.view() for k in fleet.keys.values()]

    @app.post("/api/keys", tags=["admin"], dependencies=admin, status_code=201)
    async def create_key(body: CreateKeyRequest) -> dict[str, Any]:
        key, plaintext = fleet.create_key(body.name, body.scopes)
        return {**key.view(), "key": plaintext}

    @app.delete("/api/keys/{key_id}", tags=["admin"], dependencies=admin, status_code=204)
    async def revoke_key(key_id: str) -> Response:
        fleet.revoke_key(key_id)
        return Response(status_code=204)

    @app.get("/api/audit", tags=["admin"], dependencies=admin)
    async def audit(limit: int = 100) -> list[dict[str, Any]]:
        return fleet.audit.recent(min(max(limit, 1), 500))

    @app.get("/api/backup", tags=["admin"], dependencies=admin)
    async def backup() -> dict[str, Any]:
        return fleet.export_state()

    @app.post("/api/restore", tags=["admin"], dependencies=admin)
    async def restore(request: Request, dry_run: bool = True) -> dict[str, Any]:
        data = await request.json()
        if dry_run:
            return {"dry_run": True, "changes": fleet.restore_preview(data)}
        return {"dry_run": False, "changes": fleet.restore(data)}

    # ------------------------------------------------------------------ /v1 router

    inference = Depends(scope_guard(Scope.INFERENCE))

    @app.get("/v1/models", tags=["openai"])
    async def v1_models(_: str = inference) -> dict[str, Any]:
        data = []
        for model in fleet.models.values():
            if model.state.value != "running":
                continue
            node = fleet.nodes.get(model.node_id or "")
            data.append(
                {
                    "id": model.spec.name,
                    "object": "model",
                    "created": int(model.started_at or 0),
                    "owned_by": "lapis",
                    "lapis": {
                        "node": node.name if node else None,
                        "runtime": model.spec.runtime.value,
                        "context": model.spec.context,
                    },
                }
            )
        return {"object": "list", "data": data}

    async def _proxy(request: Request, kind: str) -> Response:
        try:
            body = await request.json()
        except ValueError:
            return _error(400, "request body must be JSON")
        if not isinstance(body, dict) or not isinstance(body.get("model"), str):
            return _error(400, "'model' is required")
        model, node = fleet.route(body["model"])
        name, path = model.spec.name, INFERENCE_PATHS[kind]
        headers = {"X-Lapis-Node": node.name}

        if body.get("stream"):
            upstream = await fleet.agents.open_stream(node, path, body)
            fleet.metrics.in_flight += 1

            async def relay() -> AsyncIterator[bytes]:
                tail = b""
                try:
                    async for chunk in upstream.aiter_raw():
                        tail = (tail + chunk)[-4096:]
                        yield chunk
                finally:
                    await upstream.aclose()
                    fleet.metrics.in_flight -= 1
                    fleet.record_usage(name, upstream.status_code, _usage_from_sse(tail))

            return StreamingResponse(
                relay(),
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "text/event-stream"),
                headers=headers,
            )

        fleet.metrics.in_flight += 1
        try:
            status, payload = await fleet.agents.post(node, path, body)
        finally:
            fleet.metrics.in_flight -= 1
        tokens = 0
        if isinstance(payload, dict):
            tokens = int((payload.get("usage") or {}).get("total_tokens", 0))
        fleet.record_usage(name, status, tokens)
        return JSONResponse(payload, status_code=status, headers=headers)

    @app.post("/v1/chat/completions", tags=["openai"])
    async def chat(request: Request, _: str = inference) -> Response:
        return await _proxy(request, "chat/completions")

    @app.post("/v1/completions", tags=["openai"])
    async def completions(request: Request, _: str = inference) -> Response:
        return await _proxy(request, "completions")

    @app.post("/v1/embeddings", tags=["openai"])
    async def embeddings(request: Request, _: str = inference) -> Response:
        return await _proxy(request, "embeddings")

    @app.get("/metrics", tags=["system"])
    async def metrics(_: str = Depends(scope_guard(Scope.METRICS))) -> PlainTextResponse:
        overview = fleet.overview()
        text = fleet.metrics.render(overview["nodes"], overview["models"])
        return PlainTextResponse(text, media_type="text/plain; version=0.0.4")

    # ------------------------------------------------------------------ console

    if settings.web_dir and settings.web_dir.is_dir():
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="console")

    return app
