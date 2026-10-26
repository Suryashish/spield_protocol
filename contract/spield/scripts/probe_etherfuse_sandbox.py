#!/usr/bin/env python3
"""Check Etherfuse sandbox access/assets/quotes without creating orders or signing.

Reads only etherfusekey from ../.env. Output excludes credentials and account/wallet IDs.
The authenticated host is fixed to Etherfuse's sandbox; there is no production mode.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "https://api.sand.etherfuse.com"
SIMULATION_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
SCRIPT_DIR = Path(__file__).resolve().parent


class NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an Authorization header to a redirect target.
        raise urllib.error.HTTPError(req.full_url, code, "Redirect rejected", headers, fp)


def load_key(env_path):
    for line in Path(env_path).read_text().splitlines():
        name, separator, value = line.partition("=")
        if separator and name.strip().removeprefix("export ").lower() == "etherfusekey":
            value = value.strip()
            if value.startswith(("'", '"')):
                quote = value[0]
                end = value.find(quote, 1)
                if end < 0:
                    raise ValueError("Unterminated etherfusekey value")
                value = value[1:end]
            else:
                value = value.split(" #", 1)[0].strip()
            if not value:
                raise ValueError("etherfusekey is empty")
            return value
    raise ValueError("etherfusekey is missing")


def classify_error(status, body):
    # Return fixed classifications, never arbitrary provider bodies that could contain identifiers.
    text = json.dumps(body).lower()
    if status in (401, 403):
        return "authentication_or_permission_denied"
    if status == 429:
        return "rate_limited"
    if any(x in text for x in ("kyc", "terms and conditions", "compliance")):
        return "compliance_required"
    if status == 424 or any(x in text for x in ("liquidity", "valid quote", "trading path")):
        return "quote_path_unavailable"
    if "unsupported" in text:
        return "unsupported_asset_or_path"
    if status == 400:
        return "request_validation_failed"
    return "provider_error"


class SandboxClient:
    def __init__(self, key):
        self._key = key
        self.events = []

    def request(self, route, payload=None):
        # The allowlist prevents accidental reuse for wallet registration, orders, or production.
        allowed = {"/ramp/me", "/ramp/wallets", "/ramp/assets", "/ramp/quote"}
        if route.split("?", 1)[0] not in allowed:
            raise ValueError("Endpoint is outside the sandbox probe allowlist")
        if (route.split("?", 1)[0] == "/ramp/quote") != (payload is not None):
            raise ValueError("Only quote requests may use POST")
        request = urllib.request.Request(
            BASE + route,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Authorization": self._key, "Accept": "application/json", "Content-Type": "application/json"},
        )
        status, body = None, {}
        opener = urllib.request.build_opener(NoCredentialRedirect())
        for attempt in range(2):
            try:
                with opener.open(request, timeout=15) as response:
                    status, raw = response.status, response.read()
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    body = {"response": "non_json"}
                break
            except urllib.error.HTTPError as error:
                status = error.code
                try:
                    body = json.load(error)
                except (ValueError, UnicodeDecodeError):
                    body = {}
                break
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt == 0:
                    time.sleep(0.5)
        event = {"method": request.get_method(), "route": route.split("?", 1)[0], "httpStatus": status}
        if status != 200:
            event["errorClass"] = classify_error(status, body) if status else "network_error"
        self.events.append(event)
        return status, body


def summarize_quote(body, source, target, amount):
    # Only retain typed, validated economic fields, not account IDs, quote IDs or signed URLs.
    result = {"sourceSymbol": source, "targetSymbol": target, "requestedSourceAmount": amount}
    for field in ("sourceAmount", "destinationAmount", "exchangeRate", "feeAmount", "feeBps", "nominalRate", "etherfuseMidMarketRate"):
        value = str(body.get(field, ""))
        if re.fullmatch(r"\d+(?:\.\d+)?", value):
            result[field] = value
    for field in ("createdAt", "expiresAt"):
        value = body.get(field)
        if isinstance(value, str):
            try:
                dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                result[field] = value
            except ValueError:
                pass
    if isinstance(body.get("requiresSwap"), bool):
        result["requiresSwap"] = body["requiresSwap"]
    return result


def run_probe(client, quotes=True, control=False):
    evidence = {
        "schemaVersion": 1,
        "environment": "sandbox",
        "baseUrl": BASE,
        "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "apiVersion": "v1 /ramp (documented alongside v2 beta)",
        "ordersCreated": False,
        "transactionsSignedOrSubmitted": False,
        "productionAccessConfirmed": False,
        "productEligibilityConfirmed": False,
    }
    status, account = client.request("/ramp/me")
    evidence["authenticationPassed"] = status == 200
    if status != 200 or not isinstance(account, dict) or not account.get("id"):
        evidence["status"] = "authentication_failed"
        evidence["requests"] = client.events
        return evidence
    evidence["accountApprovalPresent"] = account.get("approvedAt") is not None
    fee = account.get("partnerFeeDefaultBps")
    evidence["partnerFeeDefaultBps"] = fee if isinstance(fee, (int, float)) and not isinstance(fee, bool) else None

    status, wallets = client.request("/ramp/wallets")
    if status != 200 or not isinstance(wallets, dict):
        raise ValueError("Sandbox wallet discovery failed")
    items = wallets.get("items", [])
    stellar = [w for w in items if w.get("blockchain") == "stellar"]
    evidence["walletInventory"] = {"firstPageCount": len(items), "totalItems": wallets.get("totalItems"),
                                  "stellarOnFirstPage": len(stellar)}
    # Prefer an approved org-owned Stellar wallet. The address remains in memory only.
    stellar.sort(key=lambda w: w.get("claimedOwnership") is True, reverse=True)
    wallet = stellar[0] if stellar else None
    address = wallet["publicKey"] if wallet else SIMULATION_ADDRESS
    evidence["registeredStellarWalletFound"] = wallet is not None
    evidence["walletClaimedOwnership"] = wallet.get("claimedOwnership") if wallet else None
    query = urllib.parse.urlencode({"blockchain": "stellar", "currency": "usd", "wallet": address})
    status, assets = client.request("/ramp/assets?" + query)
    if status != 200 or not isinstance(assets, dict):
        raise ValueError("Sandbox Stellar asset discovery failed")
    listed = assets.get("assets", [])
    evidence["assets"] = [{k: item.get(k) for k in ("symbol", "identifier", "currency")} for item in listed]
    by_symbol = {item.get("symbol"): item.get("identifier") for item in listed}
    evidence["ustryListed"] = "USTRY" in by_symbol
    evidence["usdcListed"] = "USDC" in by_symbol
    results = []
    if quotes and wallet and evidence["ustryListed"] and evidence["usdcListed"]:
        pairs = [("USDC", "USTRY"), ("USTRY", "USDC")]
        if control and "CETES" in by_symbol:
            pairs.append(("USDC", "CETES"))
        for source, target in pairs:
            payload = {"quoteId": str(uuid.uuid4()), "customerId": account["id"], "blockchain": "stellar",
                       "quoteAssets": {"type": "swap", "sourceAsset": by_symbol[source], "targetAsset": by_symbol[target]},
                       "sourceAmount": "10"}
            # walletAddress is documented chiefly for onramp bootstrapping; omit it for swap quotes.
            status, body = client.request("/ramp/quote", payload)
            result = {"httpStatus": status, **summarize_quote(body if isinstance(body, dict) else {}, source, target, "10")}
            result["quoteReturned"] = status == 200 and isinstance(body, dict) and bool(body.get("quoteId"))
            result["control"] = target == "CETES"
            if status != 200:
                result["errorClass"] = classify_error(status, body) if status else "network_error"
            results.append(result)
    evidence["quotes"] = results
    ustry_results = [q for q in results if not q["control"]]
    evidence["status"] = "sandbox_quotes_passed" if len(ustry_results) == 2 and all(q["quoteReturned"] for q in ustry_results) else "sandbox_access_verified_quotes_unconfirmed"
    evidence["requests"] = client.events
    evidence["completedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=SCRIPT_DIR.parent / ".env")
    parser.add_argument("--out", type=Path, default=SCRIPT_DIR.parent / "research/ustry/sandbox-observation.json")
    parser.add_argument("--read-only", action="store_true", help="Skip quote creation; perform GET checks only")
    parser.add_argument("--control", action="store_true", help="Also request a USDC/CETES control quote")
    args = parser.parse_args()
    client = SandboxClient(load_key(args.env))
    try:
        result = run_probe(client, quotes=not args.read_only, control=args.control)
    except ValueError as error:
        result = {"environment": "sandbox", "status": "probe_failed", "reason": str(error), "requests": client.events}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "sandbox_quotes_passed" or (args.read_only and result.get("authenticationPassed")) else 2


if __name__ == "__main__":
    raise SystemExit(main())
