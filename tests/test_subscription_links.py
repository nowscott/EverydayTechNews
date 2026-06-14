import base64
import hashlib
import hmac
import json
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from subscription_links import build_unsubscribe_link, create_subscription_token


def decode_base64url(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class SubscriptionLinkTests(unittest.TestCase):
    def test_creates_signed_unsubscribe_token(self):
        token = create_subscription_token(
            " Alice@Example.com ",
            "unsubscribe",
            "test-secret",
            now=1_000,
            ttl_seconds=60,
        )
        encoded_payload, encoded_signature = token.split(".")
        payload = json.loads(decode_base64url(encoded_payload))
        expected_signature = hmac.new(
            b"test-secret",
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()

        self.assertEqual(payload["v"], 2)
        self.assertEqual(payload["email"], "alice@example.com")
        self.assertEqual(payload["purpose"], "unsubscribe")
        self.assertEqual(payload["exp"], 1_060)
        self.assertEqual(
            decode_base64url(encoded_signature),
            expected_signature,
        )

    def test_builds_unsubscribe_link_without_double_slash(self):
        link = build_unsubscribe_link(
            "alice@example.com",
            "https://mailist.example.com/",
            "test-secret",
        )
        parsed = urlparse(link)

        self.assertEqual(
            f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
            "https://mailist.example.com/",
        )
        self.assertTrue(parse_qs(parsed.query)["unsubscribe_token"][0])


if __name__ == "__main__":
    unittest.main()
