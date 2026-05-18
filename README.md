# GitHub Hot Repo Analyzer

A Vite + React + TypeScript app with a Cloudflare Worker API.

The frontend reads a cached daily report from `/api/daily-report`. The Worker collects
GitHub repository signals at most once per day on first access, stores the result in
Cloudflare KV, and returns the cached report to later visitors.

The app also includes a repository learning map. Enter `owner/repo` or a GitHub URL
to generate a structured project analysis with a global architecture view, module
branches, key files, runbook commands, risks, and a guided reading path.

## Important Ranking Note

GitHub's public REST API does not expose "stars gained today" as a simple endpoint.
The current MVP combines several signals:

```text
created:YYYY-MM-DD stars:>0 fork:false
created:YYYY-MM-DD forks:>0 fork:false
pushed:YYYY-MM-DD stars:>100 fork:false
https://github.com/trending?since=daily
```

True 24-hour star/fork deltas are planned once historical snapshots are added.

## Scripts

```bash
npm install
npm run dev
npm run worker:dev
npm run lint
npm run typecheck
npm run worker:typecheck
npm run build
```

## Cloudflare Setup

Create a KV namespace and replace the placeholder IDs in `wrangler.toml`.

```bash
npx wrangler kv namespace create DAILY_REPORT_CACHE
npx wrangler kv namespace create DAILY_REPORT_CACHE --preview
```

Configure secrets:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put OPENAI_API_KEY
```

Deploy the Worker:

```bash
npm run worker:deploy
```

For local frontend development, set `VITE_API_BASE_URL` to the Worker URL or to
`http://localhost:8787` when running `npm run worker:dev`.

## API

Daily report:

```text
GET /api/daily-report
```

Repository learning map:

```text
POST /api/repos/analyze
GET  /api/repos/:owner/:repo/status
GET  /api/repos/:owner/:repo/analysis
GET  /api/repos/:owner/:repo/architecture
GET  /api/repos/:owner/:repo/modules/:moduleId
```

Example request:

```bash
curl -X POST "$VITE_API_BASE_URL/api/repos/analyze" \
  -H "Content-Type: application/json" \
  -d '{"url":"facebook/react"}'
```

## How It Works

- The React app calls `/api/daily-report`.
- The Worker checks KV for today's cached report.
- If today's report does not exist, the Worker starts a background generation run.
- The generation run calls GitHub Search, repository README endpoints, and GitHub Trending.
- If `OPENAI_API_KEY` is configured, the Worker asks an LLM for a Chinese daily brief.
- If no LLM key is configured, it returns a local heuristic brief.
- The latest successful report is kept as a fallback while a new report is generating.
- For repository analysis, the Worker fetches metadata, default branch SHA, recursive
  tree structure, README, languages, manifests, and selected key files.
- Repository analysis is cached by `owner/repo + default branch commit SHA`.
- The frontend renders the analysis as a global architecture map, branch details,
  reading path, runbook, and key file guide.

See `docs/progress.md` for completed work, open tasks, and known limitations.
