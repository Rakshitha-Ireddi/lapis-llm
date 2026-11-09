"""The fleet service: the single source of truth for nodes, models and keys."""

from __future__ import annotations

import asyncio
import secrets
import time
from collections import defaultdict
from typing import Any

from .. import admission, placement
from ..audit import AuditLog
from ..config import Settings
from ..domain import (
    ApiKey,
    Desired,
    EnrollRequest,
    Model,
    ModelSpec,
    ModelState,
    Node,
    NodeState,
    Scope,
    Telemetry,
)
from ..metrics import Metrics
from ..security import (
    fingerprint,
    fingerprints_match,
    new_api_key,
    new_node_secret,
    public_key_for,
    sha256_hex,
)
from ..store import JsonStore
from .agent_client import AgentClient, AgentError, AgentRefused, AgentUnavailable

STATE_VERSION = 1


class FleetError(Exception):
    status = 400
    kind = "invalid_request_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(FleetError):
    status = 404
    kind = "not_found_error"


class Conflict(FleetError):
    status = 409
    kind = "conflict_error"


class Forbidden(FleetError):
    status = 403
    kind = "permission_error"


class Unavailable(FleetError):
    status = 503
    kind = "unavailable_error"


class Fleet:
    def __init__(
        self,
        settings: Settings,
        *,
        agents: AgentClient | None = None,
        store: JsonStore | None = None,
        audit: AuditLog | None = None,
        clock=time.time,
    ) -> None:
        self.settings = settings
        self.clock = clock
        data_dir = settings.data_dir
        self.store = store or JsonStore(data_dir / "state.json" if data_dir else None)
        self.audit = audit or AuditLog(data_dir / "audit.jsonl" if data_dir else None, clock=clock)
        self.agents = agents or AgentClient()
        self.metrics = Metrics()
        self.nodes: dict[str, Node] = {}
        self.models: dict[str, Model] = {}
        self.keys: dict[str, ApiKey] = {}
        self._node_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._load()

    # ------------------------------------------------------------------ persistence

    def _load(self) -> None:
        data = self.store.load()
        self._apply_state(data, keep_secrets=True)

    def _apply_state(self, data: dict[str, Any], *, keep_secrets: bool) -> None:
        self.nodes = {}
        for raw in data.get("nodes", []):
            node = Node.model_validate(raw)
            if not keep_secrets and node.state in (NodeState.ONLINE, NodeState.DRAINING):
                # Restored without secrets: issue fresh ones; agents re-claim with
                # their identity on their next 401.
                node.secret = new_node_secret()
            self.nodes[node.id] = node
        self.models = {}
        for raw in data.get("models", []):
            model = Model.model_validate(raw)
            self.models[model.spec.name] = model
        self.keys = {k["id"]: ApiKey.model_validate(k) for k in data.get("keys", [])}

    def _snapshot(self, *, include_secrets: bool) -> dict[str, Any]:
        exclude = None if include_secrets else {"secret"}
        return {
            "version": STATE_VERSION,
            "nodes": [n.model_dump(mode="json", exclude=exclude) for n in self.nodes.values()],
            "models": [m.model_dump(mode="json") for m in self.models.values()],
            "keys": [k.model_dump(mode="json") for k in self.keys.values()],
        }

    def persist(self) -> None:
        self.store.save(self._snapshot(include_secrets=True))

    # ------------------------------------------------------------------ helpers

    def node(self, node_id: str) -> Node:
        node = self.nodes.get(node_id)
        if node is None:
            raise NotFound(f"node {node_id!r} not found")
        return node

    def model(self, name: str) -> Model:
        model = self.models.get(name)
        if model is None:
            raise NotFound(f"model {name!r} not found")
        return model

    def effective_state(self, node: Node) -> NodeState:
        if node.state in (NodeState.ONLINE, NodeState.DRAINING):
            if node.last_seen is None:
                return NodeState.OFFLINE
            if self.clock() - node.last_seen > self.settings.heartbeat_timeout_s:
                return NodeState.OFFLINE
        return node.state

    def node_view(self, node: Node) -> dict[str, Any]:
        view = node.view(self.effective_state(node))
        view["models"] = sorted(m.spec.name for m in self.models.values() if m.node_id == node.id)
        return view

    def model_view(self, model: Model) -> dict[str, Any]:
        node = self.nodes.get(model.node_id) if model.node_id else None
        return model.view(node.name if node else None)

    @property
    def reserve(self) -> float:
        return self.settings.memory_reserve_gib

    # ------------------------------------------------------------------ enrolment

    def enroll(self, req: EnrollRequest) -> Node:
        for node in self.nodes.values():
            if node.public_key == req.public_key and node.state != NodeState.REVOKED:
                node.name, node.url = req.name, req.url
                node.platform, node.runtimes = req.platform, req.runtimes
                self.persist()
                return node
        node = Node(
            id=f"node-{secrets.token_hex(4)}",
            name=req.name,
            url=req.url,
            platform=req.platform,
            runtimes=req.runtimes,
            public_key=req.public_key,
            fingerprint=fingerprint(req.public_key),
            created_at=self.clock(),
        )
        self.nodes[node.id] = node
        self.audit.record(f"agent:{node.name}", "node.enroll", node.id, node.fingerprint)
        self.persist()
        if self.settings.auto_approve:
            self.approve(node.id, node.fingerprint, actor="auto-approve")
        return node

    def approve(self, node_id: str, given_fingerprint: str, actor: str = "admin") -> Node:
        node = self.node(node_id)
        if node.state != NodeState.PENDING:
            raise Conflict(f"node {node.name} is {node.state.value}, not pending")
        if not fingerprints_match(node.fingerprint, given_fingerprint):
            self.audit.record(actor, "node.approve.mismatch", node.id, given_fingerprint)
            raise Forbidden("fingerprint does not match what the agent printed")
        node.state = NodeState.ONLINE
        node.secret = new_node_secret()
        node.last_seen = self.clock()
        self.audit.record(actor, "node.approve", node.id, node.name)
        self.persist()
        return node

    def claim(self, node_id: str, identity: str) -> str | None:
        """Hand the node secret to the agent that proves it holds the identity."""
        node = self.node(node_id)
        if public_key_for(identity) != node.public_key:
            raise Forbidden("identity does not match this node")
        if node.state == NodeState.REVOKED:
            raise Forbidden("node has been revoked")
        if node.state == NodeState.PENDING:
            return None
        return node.secret

    def authenticate_node(self, node_id: str, secret: str | None) -> Node:
        node = self.nodes.get(node_id)
        if node is None:
            raise NotFound(f"node {node_id!r} not found")
        if not node.secret or not secret:
            raise Forbidden("unknown node or missing secret")
        if not secrets.compare_digest(node.secret, secret):
            raise Forbidden("bad node secret")
        return node

    async def heartbeat(self, node_id: str, secret: str | None, telemetry: Telemetry) -> Node:
        node = self.authenticate_node(node_id, secret)
        node.telemetry = telemetry
        node.last_seen = self.clock()
        changed = False
        for model in self.models.values():
            if model.node_id != node.id:
                continue
            is_running = model.spec.name in telemetry.running
            if is_running and model.state != ModelState.RUNNING:
                model.state, model.last_error = ModelState.RUNNING, None
                changed = True
            elif not is_running and model.state == ModelState.RUNNING:
                model.state = ModelState.STOPPED
                changed = True
        if changed:
            self.persist()
        await self.reconcile(node)
        return node

    async def reconcile(self, node: Node) -> list[str]:
        """Restart models that should run on ``node`` but don't — one at a time."""
        if self.effective_state(node) not in (NodeState.ONLINE, NodeState.DRAINING):
            return []
        lock = self._node_locks[node.id]
        if lock.locked():
            return []
        restarted: list[str] = []
        async with lock:
            pending = sorted(
                (
                    m
                    for m in self.models.values()
                    if m.node_id == node.id
                    and m.desired == Desired.RUNNING
                    and m.state == ModelState.STOPPED
                ),
                key=lambda m: m.spec.name,
            )
            for model in pending:
                try:
                    await self._start_on(model, node, actor="reconciler")
                    restarted.append(model.spec.name)
                except FleetError:
                    continue
        return restarted

    def drain(self, node_id: str, actor: str = "admin") -> Node:
        node = self.node(node_id)
        if node.state != NodeState.ONLINE:
            raise Conflict(f"node {node.name} is {node.state.value}")
        node.state = NodeState.DRAINING
        self.audit.record(actor, "node.drain", node.id, node.name)
        self.persist()
        return node

    def undrain(self, node_id: str, actor: str = "admin") -> Node:
        node = self.node(node_id)
        if node.state != NodeState.DRAINING:
            raise Conflict(f"node {node.name} is not draining")
        node.state = NodeState.ONLINE
        self.audit.record(actor, "node.undrain", node.id, node.name)
        self.persist()
        return node

    def revoke(self, node_id: str, actor: str = "admin") -> Node:
        node = self.node(node_id)
        node.state = NodeState.REVOKED
        node.secret = None
        for model in self.models.values():
            if model.node_id == node.id:
                model.node_id, model.state = None, ModelState.STOPPED
        self.audit.record(actor, "node.revoke", node.id, node.name)
        self.persist()
        return node

    def remove_node(self, node_id: str, actor: str = "admin") -> None:
        node = self.node(node_id)
        if node.state not in (NodeState.PENDING, NodeState.REVOKED):
            raise Conflict("revoke the node before removing it")
        del self.nodes[node_id]
        self.audit.record(actor, "node.remove", node_id, node.name)
        self.persist()

    # ------------------------------------------------------------------ models

    def add_model(self, spec: ModelSpec, actor: str = "admin") -> Model:
        if spec.name in self.models:
            raise Conflict(f"model {spec.name!r} already exists")
        model = Model(spec=spec)
        self.models[spec.name] = model
        self.audit.record(
            actor, "model.add", spec.name, f"{spec.runtime.value} {spec.budget_gib} GiB"
        )
        self.persist()
        return model

    def remove_model(self, name: str, actor: str = "admin") -> None:
        model = self.model(name)
        if model.state in (ModelState.RUNNING, ModelState.STARTING):
            raise Conflict(f"stop {name} before removing it")
        del self.models[name]
        self.audit.record(actor, "model.remove", name)
        self.persist()

    def preview(self, spec: ModelSpec) -> list[dict[str, Any]]:
        candidates = placement.evaluate(
            spec, self.nodes.values(), self.effective_state, self.reserve
        )
        best = placement.choose(candidates)
        return [
            {
                "node_id": c.node.id,
                "node_name": c.node.name,
                "ok": c.admission.ok,
                "reason": c.admission.reason,
                "headroom_gib": c.admission.headroom_gib,
                "chosen": best is not None and best.node.id == c.node.id,
            }
            for c in candidates
            if c.node.state not in (NodeState.PENDING, NodeState.REVOKED)
        ]

    async def _start_on(self, model: Model, node: Node, actor: str) -> Model:
        adm = admission.check(
            model.spec.budget_gib, model.spec.runtime, node.runtimes, node.telemetry, self.reserve
        )
        if not adm.ok:
            model.state, model.last_error = ModelState.FAILED, adm.reason
            self.audit.record(actor, "model.start.refused", model.spec.name, adm.reason)
            self.persist()
            raise Conflict(f"{node.name} refused {model.spec.name}: {adm.reason}")
        model.node_id, model.state, model.last_error = node.id, ModelState.STARTING, None
        try:
            node.telemetry = await self.agents.start_model(node, model.spec)
        except AgentRefused as exc:
            model.state, model.last_error = ModelState.FAILED, str(exc)
            self.audit.record(actor, "model.start.refused", model.spec.name, str(exc))
            self.persist()
            raise Conflict(f"{node.name} refused {model.spec.name}: {exc}") from exc
        except AgentUnavailable as exc:
            model.state, model.last_error = ModelState.STOPPED, str(exc)
            self.persist()
            raise Unavailable(str(exc)) from exc
        except AgentError as exc:
            model.state, model.last_error = ModelState.FAILED, str(exc)
            self.persist()
            raise Conflict(str(exc)) from exc
        model.state, model.started_at = ModelState.RUNNING, self.clock()
        self.audit.record(actor, "model.start", model.spec.name, node.name)
        self.persist()
        return model

    async def start_model(
        self, name: str, node_id: str | None = None, actor: str = "admin"
    ) -> Model:
        model = self.model(name)
        model.desired = Desired.RUNNING
        if model.state in (ModelState.RUNNING, ModelState.STARTING):
            self.persist()
            return model
        if node_id:
            node = self.node(node_id)
            if self.effective_state(node) != NodeState.ONLINE:
                raise Conflict(f"node {node.name} is {self.effective_state(node).value}")
        else:
            candidates = placement.evaluate(
                model.spec, self.nodes.values(), self.effective_state, self.reserve
            )
            # Prefer the node the model last ran on, if it still fits there.
            previous = next(
                (c for c in candidates if c.node.id == model.node_id and c.admission.ok), None
            )
            chosen = previous or placement.choose(candidates)
            if chosen is None:
                reasons = "; ".join(
                    f"{c.node.name}: {c.admission.reason}"
                    for c in candidates
                    if c.node.state not in (NodeState.PENDING, NodeState.REVOKED)
                )
                model.state = ModelState.FAILED
                model.last_error = f"no node can run {name}" + (f" ({reasons})" if reasons else "")
                self.persist()
                raise Conflict(model.last_error)
            node = chosen.node
        return await self._start_on(model, node, actor)

    async def stop_model(self, name: str, actor: str = "admin") -> Model:
        model = self.model(name)
        model.desired = Desired.STOPPED
        node = self.nodes.get(model.node_id) if model.node_id else None
        if node and model.state in (ModelState.RUNNING, ModelState.STARTING):
            try:
                telemetry = await self.agents.stop_model(node, name)
                if telemetry:
                    node.telemetry = telemetry
            except AgentError:
                pass  # the node is gone; the model is stopped as far as we care
        model.state, model.last_error = ModelState.STOPPED, None
        self.audit.record(actor, "model.stop", name)
        self.persist()
        return model

    async def move_model(self, name: str, node_id: str, actor: str = "admin") -> Model:
        model = self.model(name)
        target = self.node(node_id)
        if model.node_id == target.id:
            raise Conflict(f"{name} is already on {target.name}")
        if self.effective_state(target) != NodeState.ONLINE:
            raise Conflict(f"node {target.name} is {self.effective_state(target).value}")
        adm = admission.check(
            model.spec.budget_gib,
            model.spec.runtime,
            target.runtimes,
            target.telemetry,
            self.reserve,
        )
        if not adm.ok:
            raise Conflict(f"{target.name} cannot take {name}: {adm.reason}")
        was_running = model.state == ModelState.RUNNING
        source = self.nodes.get(model.node_id) if model.node_id else None
        if was_running:
            await self.stop_model(name, actor=actor)
        model.node_id = target.id
        if not was_running:
            self.audit.record(actor, "model.move", name, target.name)
            self.persist()
            return model
        try:
            await self.start_model(name, target.id, actor=actor)
        except FleetError:
            if source is not None:
                await self.start_model(name, source.id, actor=actor)
            raise
        self.audit.record(actor, "model.move", name, target.name)
        return model

    def route(self, name: str) -> tuple[Model, Node]:
        model = self.models.get(name)
        if model is None:
            raise NotFound(f"The model '{name}' does not exist")
        node = self.nodes.get(model.node_id) if model.node_id else None
        if model.state != ModelState.RUNNING or node is None:
            raise Unavailable(f"The model '{name}' is not running")
        if self.effective_state(node) not in (NodeState.ONLINE, NodeState.DRAINING):
            raise Unavailable(f"The node serving '{name}' ({node.name}) is offline")
        return model, node

    def record_usage(self, name: str, status: int, tokens: int) -> None:
        self.metrics.observe(name, status, tokens)
        model = self.models.get(name)
        if model is not None:
            model.requests += 1
            model.tokens += tokens

    # ------------------------------------------------------------------ api keys

    def create_key(
        self, name: str, scopes: list[Scope], actor: str = "admin"
    ) -> tuple[ApiKey, str]:
        plaintext = new_api_key()
        key = ApiKey(
            id=f"key-{secrets.token_hex(4)}",
            name=name,
            prefix=plaintext[:8],
            key_hash=sha256_hex(plaintext),
            scopes=scopes,
            created_at=self.clock(),
        )
        self.keys[key.id] = key
        self.audit.record(actor, "key.create", key.id, f"{name} [{', '.join(scopes)}]")
        self.persist()
        return key, plaintext

    def revoke_key(self, key_id: str, actor: str = "admin") -> None:
        if key_id not in self.keys:
            raise NotFound(f"key {key_id!r} not found")
        key = self.keys.pop(key_id)
        self.audit.record(actor, "key.revoke", key_id, key.name)
        self.persist()

    def check_key(self, plaintext: str | None, scope: Scope) -> ApiKey | None:
        if not plaintext:
            return None
        digest = sha256_hex(plaintext)
        for key in self.keys.values():
            if secrets.compare_digest(key.key_hash, digest) and scope in key.scopes:
                key.last_used_at = self.clock()
                return key
        return None

    # ------------------------------------------------------------------ overview

    def overview(self) -> dict[str, Any]:
        nodes = [self.node_view(n) for n in self.nodes.values()]
        models = [self.model_view(m) for m in self.models.values()]
        live = [
            n
            for n in self.nodes.values()
            if self.effective_state(n) in (NodeState.ONLINE, NodeState.DRAINING) and n.telemetry
        ]
        return {
            "kpis": {
                "nodes_online": len(live),
                "nodes_total": sum(1 for n in self.nodes.values() if n.state != NodeState.REVOKED),
                "nodes_pending": sum(
                    1 for n in self.nodes.values() if n.state == NodeState.PENDING
                ),
                "models_running": sum(
                    1 for m in self.models.values() if m.state == ModelState.RUNNING
                ),
                "models_total": len(self.models),
                "tokens_per_second": round(sum(n.telemetry.tokens_per_second for n in live), 1),
                "requests_total": self.metrics.requests_total,
                "tokens_total": self.metrics.tokens_total,
                "memory_total_gib": round(sum(n.telemetry.memory_total_gib for n in live), 2),
                "memory_free_gib": round(sum(n.telemetry.memory_free_gib for n in live), 2),
            },
            "nodes": nodes,
            "models": models,
        }

    # ------------------------------------------------------------------ backup

    def export_state(self) -> dict[str, Any]:
        snapshot = self._snapshot(include_secrets=False)
        snapshot["exported_at"] = self.clock()
        return snapshot

    def restore_preview(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("version") != STATE_VERSION:
            raise FleetError(f"unsupported backup version {data.get('version')!r}")

        def diff(current: set[str], incoming: set[str]) -> dict[str, list[str]]:
            return {
                "add": sorted(incoming - current),
                "keep": sorted(incoming & current),
                "remove": sorted(current - incoming),
            }

        return {
            "models": diff(set(self.models), {m["spec"]["name"] for m in data.get("models", [])}),
            "nodes": diff(set(self.nodes), {n["id"] for n in data.get("nodes", [])}),
            "keys": diff(set(self.keys), {k["id"] for k in data.get("keys", [])}),
        }

    def restore(self, data: dict[str, Any], actor: str = "admin") -> dict[str, Any]:
        preview = self.restore_preview(data)
        self._apply_state(data, keep_secrets=False)
        for model in self.models.values():
            if model.state in (ModelState.RUNNING, ModelState.STARTING):
                model.state = ModelState.STOPPED  # the reconciler brings them back
        self.audit.record(actor, "backup.restore", "", f"{len(self.models)} models")
        self.persist()
        return preview
