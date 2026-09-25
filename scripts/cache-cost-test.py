#!/usr/bin/env python3
"""
Standalone, real-API sanity check for prompt caching savings.

Makes 3 separate calls to the real Anthropic Messages API (no mock, no Token
Wars server involved) using the same system content and question each time:

  1. no_cache    - plain call, no cache_control at all (full input price)
  2. cache_write - same content marked cacheable, first time seen (pays a
                   premium to write it into the cache)
  3. cache_read  - same content marked cacheable, sent again right after
                   (reads from cache at a steep discount)

Prints the token usage and USD cost for each, using the same per-model rates
already checked into config/pricing.json (so the numbers line up with what
the Token Wars page itself would show).

Requires ANTHROPIC_API_KEY to be set in the environment already (this script
never asks for it, prints it, or writes it anywhere).

Usage:
    python3 scripts/cache-cost-test.py [model]

    model defaults to claude-sonnet-5. Must be one of the models listed
    under "picker" in config/pricing.json.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENDPOINT = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


def load_json(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as f:
        return json.load(f)


def load_system_text():
    # Same big, realistic instructions block the demo uses for its "messy"
    # teaching prompt. Gitignored on purpose, never shipped - only used here
    # as a stand-in for "your own real project instructions".
    raw_path = os.path.join(ROOT, "prompt_before_raw.txt")
    if os.path.exists(raw_path):
        with open(raw_path, "r", encoding="utf-8") as f:
            return f.read()
    # Fallback: repeat filler text so it is comfortably above every model's
    # minimum cacheable token count, in case prompt_before_raw.txt is absent.
    filler = (
        "This is a placeholder block of project instructions used only to "
        "test prompt caching cost. It repeats on purpose so it is long "
        "enough for the API to consider it cacheable.\n"
    )
    return filler * 400


def call(api_key, model, system_text, cache_control, max_tokens=200):
    block = {"type": "text", "text": system_text}
    if cache_control:
        block["cache_control"] = {"type": "ephemeral"}
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": [block],
        "messages": [{"role": "user", "content": "In one sentence, what is this document about?"}],
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": API_VERSION,
        },
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit("API error {}: {}".format(e.code, detail))
    elapsed_ms = round((time.time() - started) * 1000)
    return payload, elapsed_ms


def usd(x):
    return "${:,.4f}".format(x)


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "claude-sonnet-5"
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise SystemExit(
            "ANTHROPIC_API_KEY is not set in this terminal.\n"
            "Run: export ANTHROPIC_API_KEY=\"sk-ant-...\"  (in this same terminal), then retry."
        )

    pricing = load_json("config/pricing.json")
    if model not in pricing["models"]:
        raise SystemExit("Unknown model '{}'. Options: {}".format(model, ", ".join(pricing["models"].keys())))
    price = pricing["models"][model]
    PER = 1_000_000

    system_text = load_system_text()
    approx_tokens = len(system_text) // 4
    print("Model: {} ({})".format(model, price["label"]))
    print("System block: {:,} characters (~{:,} tokens)".format(len(system_text), approx_tokens))
    print("Rates per million tokens: input ${} | output ${} | cache write ${} | cache read ${}".format(
        price["input"], price["output"], price["cacheWrite5m"], price["cacheRead"]))
    print()

    results = {}

    print("1/3 Calling with NO caching ...")
    no_cache, ms1 = call(api_key, model, system_text, cache_control=False)
    results["no_cache"] = (no_cache, ms1)

    print("2/3 Calling with caching ON (first time - cache WRITE) ...")
    write, ms2 = call(api_key, model, system_text, cache_control=True)
    results["cache_write"] = (write, ms2)

    print("3/3 Calling again immediately with caching ON (cache READ) ...")
    read, ms3 = call(api_key, model, system_text, cache_control=True)
    results["cache_read"] = (read, ms3)

    print()
    print("{:<12} {:>10} {:>14} {:>13} {:>10} {:>12} {:>8}".format(
        "Call", "input", "cache_write", "cache_read", "output", "cost", "ms"))

    costs = {}
    for label in ("no_cache", "cache_write", "cache_read"):
        payload, ms = results[label]
        u = payload.get("usage", {})
        inp = u.get("input_tokens", 0)
        cw = u.get("cache_creation_input_tokens", 0)
        cr = u.get("cache_read_input_tokens", 0)
        out = u.get("output_tokens", 0)
        c = (inp * price["input"] + cw * price["cacheWrite5m"] + cr * price["cacheRead"] + out * price["output"]) / PER
        costs[label] = c
        print("{:<12} {:>10} {:>14} {:>13} {:>10} {:>12} {:>8}".format(
            label, inp, cw, cr, out, usd(c), ms))

    print()
    saved = costs["no_cache"] - costs["cache_read"]
    pct = (saved / costs["no_cache"] * 100) if costs["no_cache"] else 0
    print("No caching cost:            {}".format(usd(costs["no_cache"])))
    print("Cached (2nd call) cost:     {}".format(usd(costs["cache_read"])))
    print("Savings on the repeat call: {} ({:.1f}% less)".format(usd(saved), pct))
    print()
    print("Note: the cache_write call above costs a bit MORE than no_cache (writing")
    print("the cache carries a premium). The savings show up from the 2nd identical")
    print("call onward, which is exactly what Token Wars models on screen.")


if __name__ == "__main__":
    main()
