# GitHub Hot Repo Analyzer Progress

Last updated: 2026-05-18

## Completed

- [x] Reviewed the existing Vite/React browser-only prototype.
- [x] Added a Cloudflare Worker API entrypoint at `/api/daily-report`.
- [x] Added daily KV cache keys so a completed report is reused for the same day.
- [x] Added a short-lived KV generation lock to reduce duplicate daily runs.
- [x] Added latest-success fallback data for report generation or API failures.
- [x] Added GitHub candidate collection from new repositories, fork-heavy new repositories, active repositories, and GitHub Trending page signals.
- [x] Added optional OpenAI analysis with heuristic fallback when no LLM key is configured.
- [x] Updated the React app to read the Worker API instead of calling GitHub directly from the browser.
- [x] Added frontend polling while the first report of the day is being generated.
- [x] Added Cloudflare Worker configuration and TypeScript configuration.
- [x] Verified TypeScript, lint, frontend build, and Wrangler dry-run bundling.
- [x] Added repository learning map API endpoints: analyze, status, analysis, architecture, and module detail.
- [x] Added repo analysis cache keys based on `owner/repo + default branch commit SHA`.
- [x] Added asynchronous repo analysis state with KV status and lock records.
- [x] Added repository metadata, branch, tree, README, languages, manifest, and key file collection.
- [x] Added semantic architecture grouping for entry points, interface, core, data, integrations, infrastructure, tests, docs, and build tooling.
- [x] Added structured module branches, dependencies, reading order, runbook commands, risks, and key files.
- [x] Added optional LLM enrichment for repo summaries and module purposes with heuristic fallback.
- [x] Added frontend repository input, global architecture view, module detail panel, learning path, runbook, and key file display.

## Not Completed Yet

- [ ] Create the Cloudflare KV namespace and replace the placeholder IDs in `wrangler.toml`.
- [ ] Add Worker secrets with `wrangler secret put GITHUB_TOKEN` and `wrangler secret put OPENAI_API_KEY`.
- [ ] Deploy the Worker and set `VITE_API_BASE_URL` to the deployed Worker URL.
- [ ] Run a production generation pass against the deployed Worker.
- [ ] Add historical repo snapshots for true 24-hour star/fork delta calculations.
- [ ] Add stronger single-flight locking with Durable Objects or D1 if traffic grows.
- [ ] Add a GitHub Actions deployment workflow for frontend and Worker releases.
- [ ] Add user-configurable watchlists for languages, topics, organizations, and keywords.
- [ ] Add D1/R2 persistence for very large repo analyses that may exceed comfortable KV object sizes.
- [ ] Add precise call graph extraction with language-specific parsers.
- [ ] Add a richer interactive graph library for pan, zoom, and edge routing.

## Current MVP Behavior

- First user access of the day checks KV for that day's report.
- If a report exists, the API returns it immediately.
- If no report exists, the Worker starts generation in the background and returns `202`.
- While generation is running, the frontend polls every 5 seconds.
- If a previous successful report exists, it is shown as a fallback while today's report is generating.
- If no one visits the app, no Worker request happens and no report is generated.
- Repository analysis starts from `POST /api/repos/analyze`.
- If the same commit SHA was already analyzed, the cached learning map is returned.
- If the default branch changed, the Worker starts a new background analysis.
- The frontend polls repo status and renders the learning map once ready.

## Known Limitations

- GitHub Trending has no stable official JSON API, so the current implementation parses the public Trending page as a best-effort signal.
- KV locking is intentionally lightweight for the MVP and can still race under heavy concurrent first visits.
- Without historical snapshots, the report can show current stars/forks but not true daily growth yet.
- LLM analysis depends on `OPENAI_API_KEY`; without it, the Worker returns a local heuristic analysis.
- The architecture map is semantic and heuristic; it is not a precise language-level call graph yet.
- Large repositories may produce truncated GitHub trees or large analysis objects; D1/R2 is the planned storage upgrade.
