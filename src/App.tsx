import { useState } from 'react'
import './App.css'

type SearchRepo = {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  topics?: string[]
  created_at: string
  updated_at: string
  owner: {
    login: string
    avatar_url: string
  }
}

type GitHubSearchResponse = {
  total_count: number
  items: SearchRepo[]
}

type RepoAnalysis = SearchRepo & {
  readmeExcerpt: string
  analysis: string
  signals: string[]
}

const repoCount = 6

const formatNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactRepeatedWords(value: string) {
  const words = value.split(' ')
  const compacted: string[] = []

  for (const word of words) {
    const recentWords = compacted.slice(-8).map((recentWord) => recentWord.toLowerCase())
    if (!recentWords.includes(word.toLowerCase())) {
      compacted.push(word)
    }
  }

  return compacted.join(' ')
}

function compactSummary(value: string) {
  const summary = compactRepeatedWords(value)
  return summary.length > 260 ? `${summary.slice(0, 257).trim()}...` : summary
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function githubFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const message = response.status === 403
      ? 'GitHub API rate limit reached. Please wait a bit and try again.'
      : `GitHub request failed with status ${response.status}.`
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

async function fetchReadme(owner: string, repo: string) {
  try {
    const data = await githubFetch<{ content: string }>(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
    )
    return compactRepeatedWords(stripMarkdown(decodeBase64(data.content))).slice(0, 900)
  } catch {
    return ''
  }
}

function analyzeRepo(repo: SearchRepo, readmeExcerpt: string) {
  const text = `${repo.name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')} ${readmeExcerpt}`.toLowerCase()
  const signals: string[] = []

  const categoryRules = [
    {
      label: 'AI application or agent tooling',
      words: ['ai', 'agent', 'llm', 'model', 'rag', 'openai', 'chatbot', 'inference'],
    },
    {
      label: 'Developer tool or framework',
      words: ['cli', 'framework', 'sdk', 'api', 'toolkit', 'library', 'developer', 'typescript'],
    },
    {
      label: 'Data, analytics, or automation project',
      words: ['data', 'analytics', 'pipeline', 'crawler', 'scraper', 'automation', 'dashboard'],
    },
    {
      label: 'Frontend, UI, or design system',
      words: ['react', 'vue', 'component', 'ui', 'css', 'tailwind', 'design', 'frontend'],
    },
    {
      label: 'Infrastructure or DevOps utility',
      words: ['docker', 'kubernetes', 'deploy', 'server', 'cloud', 'database', 'monitoring'],
    },
  ]

  for (const rule of categoryRules) {
    if (rule.words.some((word) => text.includes(word))) {
      signals.push(rule.label)
    }
  }

  if (repo.stargazers_count >= 100) {
    signals.push('Fast early attention')
  }

  if ((repo.topics ?? []).length > 0) {
    signals.push(`Tagged: ${(repo.topics ?? []).slice(0, 3).join(', ')}`)
  }

  const plainDescription = repo.description?.trim()
  const summarySource = compactSummary(plainDescription || readmeExcerpt || 'No public summary is available yet.')
  const category = signals.find((signal) => !signal.startsWith('Tagged:')) ?? 'New open source project'

  return {
    analysis: `${category}. ${summarySource}`,
    signals: signals.slice(0, 4),
  }
}

function App() {
  const [repos, setRepos] = useState<RepoAnalysis[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [today] = useState(getTodayIsoDate)

  async function loadHotRepos() {
    setIsLoading(true)
    setError('')

    try {
      const query = encodeURIComponent(`created:${today} stars:>0`)
      const data = await githubFetch<GitHubSearchResponse>(
        `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${repoCount}`,
      )

      const enrichedRepos = await Promise.all(
        data.items.map(async (repo) => {
          const readmeExcerpt = await fetchReadme(repo.owner.login, repo.name)
          const analysis = analyzeRepo(repo, readmeExcerpt)

          return {
            ...repo,
            readmeExcerpt,
            ...analysis,
          }
        }),
      )

      setRepos(enrichedRepos)
      setLastUpdated(new Date().toLocaleString())
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Something went wrong.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">GitHub daily signal</p>
          <h1 id="page-title">Find today&apos;s hottest new repositories.</h1>
          <p className="lede">
            One click fetches repositories created today on GitHub, ranks them by stars,
            and explains what each project appears to do.
          </p>
        </div>

        <div className="action-panel">
          <button className="primary-action" type="button" onClick={loadHotRepos} disabled={isLoading}>
            {isLoading ? 'Analyzing...' : 'Get Today Hot Repos'}
          </button>
          <p>
            Ranking basis: repositories created on {today}, sorted by current stars.
          </p>
          {lastUpdated && <span>Last updated {lastUpdated}</span>}
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      {repos.length === 0 && !error && (
        <section className="empty-state" aria-label="Empty state">
          <h2>Ready when you are</h2>
          <p>
            The first request may take a few seconds because the app also reads README
            files for better context.
          </p>
        </section>
      )}

      {repos.length > 0 && (
        <section className="repo-grid" aria-label="GitHub repository analysis">
          {repos.map((repo, index) => (
            <article className="repo-card" key={repo.id}>
              <div className="repo-rank">#{index + 1}</div>
              <div className="repo-header">
                <img src={repo.owner.avatar_url} alt="" />
                <div>
                  <a href={repo.html_url} target="_blank" rel="noreferrer">
                    {repo.full_name}
                  </a>
                  <p>{repo.language ?? 'Unknown language'}</p>
                </div>
              </div>

              <p className="analysis">{repo.analysis}</p>

              <div className="stat-row" aria-label="Repository stats">
                <span>{formatNumber.format(repo.stargazers_count)} stars</span>
                <span>{formatNumber.format(repo.forks_count)} forks</span>
                <span>{formatNumber.format(repo.open_issues_count)} issues</span>
              </div>

              {repo.signals.length > 0 && (
                <div className="signal-list" aria-label="Analysis signals">
                  {repo.signals.map((signal) => (
                    <span key={signal}>{signal}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

export default App
