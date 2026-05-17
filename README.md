# GitHub Hot Repo Analyzer

A Vite + React + TypeScript app created from `wonderl17/vite-ts-react-startup`.

Click once to fetch repositories created today on GitHub, rank the top results by current stars, and generate a lightweight explanation of what each project appears to do.

## Important Ranking Note

GitHub's public REST API does not expose "stars gained today" as a simple endpoint. This app uses the closest no-backend public query:

```text
created:YYYY-MM-DD stars:>0 sort:stars
```

That means it finds repositories created today and sorts them by their current star count.

## Scripts

```bash
npm install
npm run dev
npm run lint
npm run build
```

## How It Works

- Calls GitHub Search API for repositories created today.
- Fetches each repository README when available.
- Combines name, description, topics, language, stars, and README text.
- Produces a local heuristic analysis in the browser.

No server or GitHub token is required, but unauthenticated GitHub API rate limits still apply.
