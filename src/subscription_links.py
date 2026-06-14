import base64
import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import quote


TOKEN_VERSION = 2
UNSUBSCRIBE_TTL_SECONDS = 45 * 24 * 60 * 60


def _base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_subscription_token(
    email,
    purpose,
    secret,
    now=None,
    ttl_seconds=UNSUBSCRIBE_TTL_SECONDS,
):
    issued_at = int(time.time() if now is None else now)
    payload = {
        "v": TOKEN_VERSION,
        "email": email.strip().lower(),
        "exp": issued_at + ttl_seconds,
        "jti": secrets.token_urlsafe(16),
        "purpose": purpose,
    }
    encoded_payload = _base64url(
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signature = _base64url(
        hmac.new(
            secret.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    return f"{encoded_payload}.{signature}"


def build_unsubscribe_link(email, base_url, secret):
    token = create_subscription_token(email, "unsubscribe", secret)
    normalized_base_url = base_url.rstrip("/")
    return f"{normalized_base_url}/?unsubscribe_token={quote(token, safe='')}"
