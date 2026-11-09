"""Small, dependency-free security helpers: hashing, fingerprints, sessions, API keys."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

API_KEY_PREFIX = "lap_"


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_identity() -> str:
    """A node's private identity. Only its SHA-256 (the public key) leaves the node."""
    return secrets.token_hex(32)


def public_key_for(identity: str) -> str:
    return sha256_hex(identity)


def fingerprint(public_key: str) -> str:
    """Human-comparable fingerprint, e.g. ``3F:A2:...`` (16 bytes)."""
    digest = hashlib.sha256(bytes.fromhex(public_key)).hexdigest()[:32].upper()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def normalise_fingerprint(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch in "0123456789ABCDEF")


def fingerprints_match(expected: str, given: str) -> bool:
    return hmac.compare_digest(normalise_fingerprint(expected), normalise_fingerprint(given))


def new_api_key() -> str:
    return API_KEY_PREFIX + secrets.token_urlsafe(24)


def new_node_secret() -> str:
    return secrets.token_urlsafe(32)


class SessionSigner:
    """Stateless admin sessions: ``<expiry>.<hmac>``."""

    def __init__(self, secret: str, ttl_seconds: int = 12 * 3600, clock=time.time) -> None:
        self._key = secret.encode()
        self._ttl = ttl_seconds
        self._clock = clock

    def _sign(self, payload: str) -> str:
        return hmac.new(self._key, payload.encode(), hashlib.sha256).hexdigest()

    def issue(self) -> str:
        expiry = str(int(self._clock()) + self._ttl)
        return f"{expiry}.{self._sign(expiry)}"

    def verify(self, token: str | None) -> bool:
        if not token or "." not in token:
            return False
        expiry, signature = token.split(".", 1)
        if not expiry.isdigit():
            return False
        if not hmac.compare_digest(signature, self._sign(expiry)):
            return False
        return int(expiry) > self._clock()
