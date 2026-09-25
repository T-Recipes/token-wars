# Token Wars demo

A local web page for the stage that shows what AI answers cost: model, effort and context dropdowns, five cost tiles per answer, a list of every charge, and a How to Cache page with a copy-paste prompt for adding reuse to any project. Every label is plain English with an (i) explanation; the audience never sees developer terms. No dependencies; needs Node 20 or newer.

## Run it

```
cp .env.example .env        # then paste your key after ANTHROPIC_API_KEY=
npm start                   # opens on http://127.0.0.1:4173/
```

- `npm run mock`: offline rehearsal. Canned answers and cache accounting, no API calls, no key needed. Nothing on screen says so: the only indicator is the terminal banner ("REHEARSAL mode"). Don't present from it.
- `npm run check`: makes a few small real calls (a few cents) and prints READY or NOT READY in plain words, including a call on each of the three picker models and whether reusing instructions produces a cost drop on each. Run it before going on stage, and again after swapping in real content.
- `npm test`: unit and server tests.
- `npm run check:layout` (needs Node 22 and Chrome): opens every view at 1920x1080 in headless Chrome (rehearsal mode) and fails on horizontal scroll, clipped elements, text under 18px, console errors, a giveaway key appearing in the page, a tooltip leaving the screen, a mis-sized or unlinked logo, the model or effort dropdown not showing a cost difference, the minimize button not working, or any jargon or demo-disclosure word on screen or in a tooltip. Add `--network` to also prove the giveaway's direct browser call works (it sends a fake key to Anthropic and expects "Key not accepted"). Screenshots go to `artifacts/`.
- `npm run package:giveaway`: builds `dist/token-wars-giveaway/` (and a `.zip`) for handing out. It refuses to build if anything from `prompts/`, `data/`, `knowledge/`, stage config, `.env`, any `.txt` file (including `prompt_before_raw.txt`), a key-shaped string, or any line of `prompt_before_raw.txt` would be included.
- `npm run watch`: starts the "Watch my app" live proxy and dashboard on `http://127.0.0.1:4174/` (port configurable with `WATCH_PORT` in `.env`). See below.

The views are listed in the menu on the left, under the logo (which links to the company's site in a new tab). The **«** button, or **M**, minimizes that menu. Reuse is on, rules are the messy version and the whole library is sent: those settings still run behind the scenes (defaults in `config/demo.json`) but have no switches on screen, to keep the page simple.

On stage: press **1** to **8** to switch views (**1** to **7** without `config/at_scale.json`, e.g. in the public repo), **F** for full screen, **M** to minimize the menu, **Esc** to dismiss a message or tooltip.

## Views

1. **Get Started**: first in the menu and the page the stage opens on. Cursor, Codex and Claude Code tabs, five numbered steps each, one copy button on the setup instructions; step 2 reads "Open it in Claude Code, Codex or Cursor". Step 5, "Tools", is a set of QR-code cards (name, one-line blurb, link) for resources worth sharing after the session; edit or remove entries under `resources.items` in `config/get_started.json` (each needs a matching image under `assets/`, regenerated with `node scripts/make-qr.js` if a link changes). All text is in `config/get_started.json`, and any field there may hold a blank line to become more than one paragraph; put the real download link in `download.text`.
2. **WTF is Cache?**: three plain-language tiles (What is Cache?, Why is Cache Important?, Caching Best Practices) and a one-picture explainer that treats the instructions as a campaign brief: four questions without caching (the brief read in full each time) against four with it (saved once, then taken from file), with bar widths and prices from the selected model and the current brief size. In the giveaway it uses the attendee's own brief, or a 3,750-word example before one is pasted.
3. **How to Cache**: a copy-paste prompt for Cursor, Codex or Claude Code that adds prompt caching to an existing project on its own branch without changing anything else, the one `cache_control` line, and six numbered steps for after the prompt is pasted (answer questions, approve the changes, connect an Anthropic API key with a copyable prompt that never asks for the key in chat, check the saving with copyable check and fix prompts, an optional pointer to `npm run watch` for a live view of the saving, and a "Click here" link to book a support session at calendly.com/techrecipes/tech-recipes-clone).
4. **Cache Cleanup**: the messy rules (`prompts/prompt_before_cleanup.md`, titled *Without caching*) and the clean rules (`prompts/prompt_after_cleanup.md`, titled *With caching*) side by side in full, with clashes, repeats and fixes highlighted from `conflicts.json`; each column opens at its first highlight. There is no question box and no AI call on this page. Each column shows what its rules cost to send with every question, worked out from their length at the model picked on the other pages: the messy rules at the full input price, the clean rules at the cache-read price (with the one-off price to cache them). The line under the columns gives the combined saving from cleanup plus caching. Not shown in the giveaway.
5. **Before & After**: the same question answered twice at once, *Without caching* and *With caching* (the instructions are saved first if needed, so the cached side shows the steady-state price). It shares the question box and dropdowns with Token Cost, so a question typed on either page is waiting on the other. The context line shows both prices with 300K or 1M tokens attached.
6. **Token Cost**: type a question and press Ask; choose the AI model (Claude Sonnet 5, Claude Opus 5.5, Claude Fable 5.1), effort (Low, Medium, High) and context (300K, 1M) from the dropdowns underneath. Five tiles follow: Input Tokens (read fresh at full price), Output Tokens (what the AI writes, including any thinking), Cost without caching (every token at the full price), Cost with caching (what the answer actually cost, instructions read from cache), and Percent Savings (the gap between those two). The context line under the tiles is arithmetic, not a call: the answer's cost without caching plus 300K or 1M tokens at the full input price, and its cost with caching plus the same tokens at the cache-read price. The page title above the question box comes from `subtitle` in `config/demo.json`. The model's rates and the "prices checked" date sit under it. Effort is sent as `output_config.effort`; changing it (like changing the model) re-saves the instructions when reuse is on.
7. **At Scale** (only when `config/at_scale.json` exists, e.g. this local repo but not the public one): a case-study table, one row per knowledge department (documents, tokens, uncached cost, cached cost, % savings) plus a total. Rows come from `config/at_scale.json` (stage only, blocked from the giveaway package); costs are worked out from `config/pricing.json` for 1,000 questions per department on Claude Fable 5.1, each question sending the whole department, with one cache write and reads for the rest. A large line above the table shows the total saving (uncached total minus cached total). Not shown in the giveaway or the public repo.
8. **Watch my app**: an "Add it to your own project" copy-paste prompt, in the same style as How to Cache, that gets your own project's Anthropic calls pointed at the "Watch my app" proxy (below) instead of rewriting anything, plus three plain steps for running it and turning it back off. This tab always shows on the stage build, right after At Scale when that data exists (or in its place when it doesn't, e.g. the public repo). The giveaway keeps its own separate library tab instead, filled from the attendee's own reference pages, since that tab does real work there.

## How reusing instructions (prompt caching) works

When reuse is on, `cache_control` is added to the instructions block, and also to the library block when everything is sent. Turning reuse on, or changing the model, effort, rules or what gets sent while it is on, fires one small call that saves the instructions, so the next question, even a different one, reads them at a fraction of the price. The API keeps the copy for 5 minutes after its last use, so after 4.5 minutes the page saves them again just before the next question. Those calls are billed like any other but are not rows in the LLM comparison table, which lists only questions asked on Token Cost (settings, TTL cost without caching, CTC cost with caching, % savings, plus a running total row). Instructions below the model's minimum (1,024 tokens on Sonnet 5, 512 on Opus 5.5 and Fable 5.1) are not reused, and the page says so in plain words.

## Swapping in real content

The prompts are a generic teaching version, based on a real production prompt and stripped of anything proprietary. The messy one (about 4,000 tokens) carries the repeats, reminder blocks, contradicting rules and long examples that real prompts pick up, so it is nearly three times the clean one (about 1,430 tokens); both stay above the caching minimum. The other files are invented stand-ins, flagged `"placeholder": true`. Nothing on screen shows the flag; the terminal lists the flagged files at startup so you know what is still a stand-in.

| File | What it holds |
| --- | --- |
| `prompts/prompt_before_cleanup.md` | The messy prompt |
| `prompts/prompt_after_cleanup.md` | The cleaned-up prompt |
| `conflicts.json` | Line numbers to highlight red and green in each prompt |
| `data/demo_campaigns.json` | Campaign data sent to the model with every question |
| `config/knowledge_center.json` | Shelf categories, file counts and token totals shown on tiles, keywords, and which pages each category sends |
| `knowledge/*.md` | The pages actually sent to the model |
| `config/demo.json` | Stage questions, default model, answer length, timeout, projection line |
| `config/get_started.json` | Get Started tab text, including the download link and setup instructions |
| `config/pricing.json` | Prices, the "verified on" date shown on screen, and the three picker models with their button names |

Content (including prices and timeout) is re-read on every request, so edits show up on the next page reload without restarting. `config/pricing.json` holds real Anthropic prices; update `verifiedOn` whenever you re-check them.

`prompt_before_raw.txt`, if present in the repo root, is the production prompt the teaching version came from. It is gitignored, must never be committed or copied, and a test fails if any tracked file contains one of its lines.

## Watch my app

`npm run watch` starts a second, separate local process: a loopback-only proxy plus a live dashboard, meant for wiring this repo's ideas into your own project rather than for presenting on stage. Point your own project's Anthropic client at `http://127.0.0.1:4174` instead of `https://api.anthropic.com` (nothing else about the request changes), and open `http://127.0.0.1:4174/` in a browser: every real call your app makes shows up there as it happens, with a running total spent, what it would have cost without caching, and the percent saved. The stage build's own "Watch my app" tab has a copy-paste prompt for wiring your project up to it (see Views, above); it doesn't start the proxy itself, it just sets your project up to reach it once you run `npm run watch`.

Trust boundary, stated plainly: unlike the giveaway (where the key goes straight from the attendee's browser to Anthropic and never touches anything of ours), this proxy sits between your app and Anthropic on your own machine, so your API key and request/response bytes do pass through this process in memory on their way through. It never writes the key, a prompt, or an answer to disk or to its own console; only the model name, token counts, cost, and latency are kept, only in memory, and only until the process is stopped. It forwards every request and response byte-for-byte (streaming responses are relayed live, not buffered) and only ever talks to `api.anthropic.com`; there is no way to point it anywhere else from a request. It is not included in the giveaway package or the public repo's "At Scale" data.

## Security

- The key is read from `.env` only, held in the server's memory, and sent only to `https://api.anthropic.com/v1/messages` (the endpoint is hard-coded). It never reaches the browser on the stage page.
- Logs, API responses, and error messages pass through a redactor. On-screen errors are fixed plain-language messages; upstream error text and stack traces are never shown.
- The server listens on 127.0.0.1 only and rejects requests from other sites or host names.
- Pages ship a Content-Security-Policy: the stage page can only talk to this server; the giveaway page can only talk to this server and `api.anthropic.com`. No fonts, analytics, or other external requests.

## Giveaway

`/giveaway/` is the same UI with no bundled instructions, data, questions, or domain logic: a measurement tool only. Attendees paste their own instructions and API key on the Your setup screen. The key is held in the tab's memory only, sent only to `api.anthropic.com` directly from the browser, and forgotten on reload. See `giveaway/SETUP.md`, written for non-developers.
