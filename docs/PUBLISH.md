# Publishing the public repo

This repo (the one you're reading this in) is the full "presentation" copy, and its
logo links to `www.techrecipes.com`. It is never pushed anywhere public as-is; a
sanitized snapshot is built first.

`npm run package:public` builds that snapshot at `dist/token-wars-public/`: everything
tracked in git. `config/at_scale.json` (the At Scale case study numbers) is included as
of the numbers currently in that file — publishing it has been explicitly approved. If
that approval is ever revoked, strip the file back out in `scripts/package-public.js`
and re-add it to `PUBLIC_FORBIDDEN` in `scripts/package-check.js`; the frontend already
falls back to the "Watch my app"-only menu (no At Scale tab) when the file is missing,
so removing it again is a one-line change, not a redesign.

The build refuses to run if a real `.env`, `prompt_before_raw.txt`, or anything under
`artifacts/` or `dist/` would be included, or if any file mentions an internal-only
project name or credential fragment (see `scripts/package-check.js`).

Before every publish, re-read `config/at_scale.json` yourself and confirm the numbers
in it are still ones you're comfortable making public — this file changes over time
(department names, document/token counts) and each new version needs the same
sign-off as the first one did.

## Steps

1. Build and review the snapshot:

   ```
   npm run package:public
   cd dist/token-wars-public
   npm test
   npm run check:layout   # confirm the last tab reads "Watch my app", not "At Scale"
   ```

   Open `http://127.0.0.1:4173/` yourself (`npm start` after adding a throwaway
   `.env`) and click through every tab once before publishing. This is the last
   human check; the automated one only catches what it knows to look for.

2. Turn it into a single-commit git history (run from inside
   `dist/token-wars-public/`):

   ```
   git init -b main
   git add -A
   git commit -m "Token Wars: what does one AI answer really cost?"
   ```

3. Create the GitHub repo under the T-Recipes organization (not any personal or
   other account) and push:

   ```
   gh repo create T-Recipes/token-wars --public --source=. --remote=origin --push
   ```

   If `gh` isn't authenticated yet, run `gh auth login` first (or
   `gh auth refresh -h github.com` if it's logged into the wrong account).
   If the repo name `token-wars` is already taken, agree on a different name
   before running the command; renaming after publishing is possible but
   changes the clone URL everyone has.

4. Afterwards, double check on GitHub.com itself (not just locally) that:
   - The repo is under the `T-Recipes` org, and is Public.
   - There is exactly one commit.
   - No real `.env`, no `prompt_before_raw.txt`, and nothing under
     `artifacts/` or `dist/` shows up in the file browser.
   - `config/at_scale.json`'s numbers match what you most recently approved
     for publishing (re-check this every time the file changes, not just the
     first time).

This process does not touch this local repo's own git history, branches, or remotes.
