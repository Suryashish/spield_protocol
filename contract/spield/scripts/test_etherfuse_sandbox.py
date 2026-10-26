import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from probe_etherfuse_sandbox import NoCredentialRedirect, SandboxClient, classify_error, load_key, run_probe, summarize_quote


class FakeClient:
    def __init__(self, quote_status=200, claimed=True):
        self.events = []
        self.payloads = []
        self.quote_status = quote_status
        self.claimed = claimed

    def request(self, route, payload=None):
        self.events.append({"route": route.split("?", 1)[0]})
        if route == "/ramp/me":
            return 200, {"id": "private-org-id", "displayName": "private-name", "approvedAt": "today", "partnerFeeDefaultBps": 0}
        if route == "/ramp/wallets":
            return 200, {"totalItems": 1, "items": [{"publicKey": "private-wallet-address", "walletId": "private-wallet-id", "blockchain": "stellar", "claimedOwnership": self.claimed}]}
        if route.startswith("/ramp/assets?"):
            return 200, {"assets": [{"symbol": symbol, "identifier": symbol + ":public-issuer", "currency": "usd"} for symbol in ["USDC", "USTRY", "CETES"]]}
        if route == "/ramp/quote":
            self.payloads.append(payload)
            if self.quote_status != 200:
                return self.quote_status, {"message": "Temporarily unable to get a valid quote for this trading path", "sensitive": "private-org-id"}
            return 200, {"quoteId": "private-quote-id", "sourceAmount": "10", "destinationAmount": "9.8", "exchangeRate": "0.98", "feeBps": "20", "feeAmount": "0.02", "customerId": "private-org-id"}
        raise AssertionError("Unexpected route")


class SandboxProbeTests(unittest.TestCase):
    def test_loads_only_designated_key_with_quotes_and_comments(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / ".env"
            p.write_text("OTHER_SECRET=never-load\nexport etherfusekey='test-key' # comment\n")
            self.assertEqual(load_key(p), "test-key")
            p.write_text("etherfusekey=test-key # comment\n")
            self.assertEqual(load_key(p), "test-key")

    def test_empty_and_missing_key_fail_without_values(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / ".env"
            for text in ["OTHER_SECRET=sensitive", "etherfusekey="]:
                p.write_text(text)
                with self.assertRaises(ValueError) as error:
                    load_key(p)
                self.assertNotIn("sensitive", str(error.exception))

    def test_disallows_orders_wallet_registration_and_arbitrary_urls(self):
        client = SandboxClient("test-key")
        for route in ["/ramp/order", "/ramp/swap", "/ramp/wallet", "https://another.example/ramp/me"]:
            with self.assertRaises(ValueError):
                client.request(route, {})

    def test_only_quotes_may_post(self):
        with self.assertRaises(ValueError):
            SandboxClient("test-key").request("/ramp/me", {"unexpected": True})

    def test_quote_summary_does_not_copy_ids_or_urls(self):
        result = summarize_quote({"customerId": "private", "quoteId": "private", "exchangeRate": "1.02", "sourceAmount": "10", "signedUrl": "private"}, "USDC", "USTRY", "10")
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(result["exchangeRate"], "1.02")

    def test_success_confirms_quotes_but_never_production_or_eligibility(self):
        client = FakeClient()
        result = run_probe(client)
        self.assertEqual(result["status"], "sandbox_quotes_passed")
        self.assertFalse(result["productionAccessConfirmed"])
        self.assertFalse(result["productEligibilityConfirmed"])
        self.assertFalse(result["ordersCreated"])
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(client.payloads[1]["quoteAssets"]["sourceAsset"], "USTRY:public-issuer")

    def test_424_is_not_misreported_as_a_successful_exit(self):
        result = run_probe(FakeClient(quote_status=424), control=True)
        self.assertEqual(result["status"], "sandbox_access_verified_quotes_unconfirmed")
        self.assertEqual(len(result["quotes"]), 3)
        self.assertTrue(all(q["errorClass"] == "quote_path_unavailable" for q in result["quotes"]))
        self.assertNotIn("private", json.dumps(result))

    def test_get_only_mode_creates_no_quotes(self):
        client = FakeClient()
        result = run_probe(client, quotes=False)
        self.assertEqual(client.payloads, [])
        self.assertTrue(result["ustryListed"])

    def test_error_classification_does_not_echo_provider_data(self):
        self.assertEqual(classify_error(400, {"message": "secret private wallet"}), "request_validation_failed")
        self.assertEqual(classify_error(401, {"apiKey": "secret"}), "authentication_or_permission_denied")

    def test_get_request_has_recorded_method_and_no_key_in_events(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'{"id":"private-org-id"}'
        client = SandboxClient("test-secret")
        with patch("urllib.request.OpenerDirector.open", return_value=Response()):
            status, _ = client.request("/ramp/me")
        self.assertEqual(status, 200)
        self.assertEqual(client.events[0]["method"], "GET")
        self.assertNotIn("test-secret", json.dumps(client.events))

    def test_redirects_cannot_forward_credentials_to_another_host(self):
        req = urllib.request.Request("https://api.sand.etherfuse.com/ramp/me", headers={"Authorization": "test-secret"})
        with self.assertRaises(urllib.error.HTTPError):
            NoCredentialRedirect().redirect_request(req, None, 302, "Found", {}, "https://another.example/")


if __name__ == "__main__":
    unittest.main()
