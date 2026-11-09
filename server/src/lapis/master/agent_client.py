"""How the master talks to node agents."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from ..domain import ModelSpec, Node, Telemetry

TOKEN_HEADER = "X-Lapis-Token"

TransportFactory = Callable[[str], httpx.AsyncBaseTransport]


class AgentError(Exception):
    """The agent answered, but not with success."""


class AgentUnavailable(AgentError):
    """The agent could not be reached."""


class AgentRefused(AgentError):
    """The agent refused the request (for example: not enough memory)."""


class AgentClient:
    def __init__(
        self,
        transport_factory: TransportFactory | None = None,
        start_timeout_s: float = 900.0,
    ) -> None:
        self._transport_factory = transport_factory
        self._start_timeout = start_timeout_s
        self._clients: dict[str, httpx.AsyncClient] = {}

    def _client(self, node: Node) -> httpx.AsyncClient:
        client = self._clients.get(node.url)
        if client is None or client.is_closed:
            transport = self._transport_factory(node.url) if self._transport_factory else None
            client = httpx.AsyncClient(
                base_url=node.url,
                transport=transport,
                timeout=httpx.Timeout(10.0, read=600.0),
            )
            self._clients[node.url] = client
        return client

    @staticmethod
    def _headers(node: Node) -> dict[str, str]:
        return {TOKEN_HEADER: node.secret or ""}

    @staticmethod
    def _detail(response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return response.text or f"HTTP {response.status_code}"
        if isinstance(body, dict):
            detail = body.get("detail") or body.get("error", {}).get("message")
            if detail:
                return str(detail)
        return f"HTTP {response.status_code}"

    async def _request(self, node: Node, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            return await self._client(node).request(
                method, path, headers=self._headers(node), **kwargs
            )
        except httpx.TransportError as exc:
            raise AgentUnavailable(f"cannot reach {node.name} at {node.url}: {exc}") from exc

    async def start_model(self, node: Node, spec: ModelSpec) -> Telemetry:
        response = await self._request(
            node,
            "POST",
            "/agent/models/start",
            json=spec.model_dump(mode="json"),
            timeout=self._start_timeout,
        )
        if response.status_code == 409:
            raise AgentRefused(self._detail(response))
        if response.is_error:
            raise AgentError(self._detail(response))
        return Telemetry.model_validate(response.json()["telemetry"])

    async def stop_model(self, node: Node, name: str) -> Telemetry | None:
        response = await self._request(node, "POST", f"/agent/models/{name}/stop")
        if response.is_error:
            raise AgentError(self._detail(response))
        return Telemetry.model_validate(response.json()["telemetry"])

    async def post(self, node: Node, path: str, body: dict[str, Any]) -> tuple[int, Any]:
        response = await self._request(node, "POST", path, json=body)
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, {"error": {"message": response.text}}

    async def open_stream(self, node: Node, path: str, body: dict[str, Any]) -> httpx.Response:
        client = self._client(node)
        request = client.build_request("POST", path, json=body, headers=self._headers(node))
        try:
            return await client.send(request, stream=True)
        except httpx.TransportError as exc:
            raise AgentUnavailable(f"cannot reach {node.name} at {node.url}: {exc}") from exc

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.aclose()
        self._clients.clear()
