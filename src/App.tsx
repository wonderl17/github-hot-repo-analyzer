import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ReportRepo = {
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
  pushed_at: string | null
  owner: {
    login: string
    avatar_url: string
  }
  sources: string[]
  trendRank?: number
  signalScore: number
  heuristicAnalysis: {
    summary: string
    category: string
    whyWatch: string
    risks: string[]
    action: 'try' | 'watch' | 'skip'
  }
}

type DailyReport = {
  dateKey: string
  generatedAt: string
  timezone: string
  repoCount: number
  sources: {
    githubSearch: string[]
    githubTrending: string
    llm: 'openai' | 'heuristic'
  }
  analysis: {
    overview: string
    marketSignals: string[]
    notablePatterns: string[]
    risks: string[]
    recommendations: string[]
  }
  repos: ReportRepo[]
}

type DailyApiResponse =
  | {
      status: 'ready'
      source: 'cache' | 'fresh'
      dateKey: string
      generatedAt: string
      report: DailyReport
    }
  | {
      status: 'generating'
      dateKey: string
      message: string
      fallbackReport?: DailyReport
    }
  | {
      status: 'error'
      dateKey: string
      message: string
      fallbackReport?: DailyReport
    }

type ArchitectureKind =
  | 'overview'
  | 'entry'
  | 'interface'
  | 'core'
  | 'data'
  | 'integration'
  | 'infra'
  | 'test'
  | 'docs'
  | 'build'

type ArchitectureNode = {
  id: string
  label: string
  kind: ArchitectureKind
  summary: string
  fileCount: number
  keyFiles: string[]
  directories: string[]
  confidence: number
}

type ArchitectureEdge = {
  from: string
  to: string
  label: string
}

type RepoModule = {
  id: string
  name: string
  kind: ArchitectureKind
  purpose: string
  directories: string[]
  keyFiles: string[]
  dependencies: string[]
  usedBy: string[]
  readingOrder: string[]
  branches: Array<{
    id: string
    name: string
    summary: string
    files: string[]
  }>
  risks: string[]
}

type LearningStep = {
  id: string
  title: string
  duration: string
  goal: string
  files: string[]
  outcomes: string[]
}

type KeyFile = {
  path: string
  role: string
  moduleId: string
  excerpt: string
}

type RepoAnalysis = {
  analysisVersion: number
  owner: string
  repo: string
  fullName: string
  htmlUrl: string
  defaultBranch: string
  commitSha: string
  generatedAt: string
  source: {
    llm: 'openai' | 'heuristic'
    treeTruncated: boolean
    fileCount: number
    sampledFileCount: number
  }
  overview: {
    summary: string
    problem: string
    techStack: string[]
    primaryLanguage: string
    languages: Record<string, number>
    difficulty: 'beginner' | 'intermediate' | 'advanced'
    audience: string[]
    maintenanceSignals: string[]
  }
  architecture: {
    nodes: ArchitectureNode[]
    edges: ArchitectureEdge[]
  }
  modules: RepoModule[]
  learningPath: LearningStep[]
  keyFiles: KeyFile[]
  runbook: {
    install: string[]
    run: string[]
    test: string[]
    configFiles: string[]
  }
  risks: string[]
}

type RepoAnalyzeResponse =
  | {
      status: 'ready'
      owner: string
      repo: string
      commitSha: string
      source: 'cache'
      analysis: RepoAnalysis
    }
  | {
      status: 'generating'
      owner: string
      repo: string
      commitSha: string
      message: string
      statusUrl: string
    }
  | {
      status: 'error'
      owner?: string
      repo?: string
      message: string
    }

type RepoStatusResponse = {
  status: 'ready' | 'generating' | 'error' | 'missing'
  owner: string
  repo: string
  commitSha?: string
  generatedAt?: string
  message: string
}

type RepoAnalysisResponse =
  | {
      status: 'ready'
      analysis: RepoAnalysis
    }
  | {
      status: 'generating' | 'missing' | 'error'
      message: string
    }

type Mode = 'daily' | 'repo'

const formatNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const pollDelayMs = 5000
const maxDailyPollAttempts = 18
const maxRepoPollAttempts = 40

function buildApiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!baseUrl) {
    return path
  }

  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function sourceLabel(source: string) {
  if (source === 'github-trending') return 'Trending'
  if (source.includes('created:')) return 'New repo'
  if (source.includes('pushed:')) return 'Active today'
  return 'Search'
}

function App() {
  const [mode, setMode] = useState<Mode>('daily')
  const [report, setReport] = useState<DailyReport | null>(null)
  const [isFallback, setIsFallback] = useState(false)
  const [isLoadingDaily, setIsLoadingDaily] = useState(false)
  const [dailyStatusMessage, setDailyStatusMessage] = useState('')
  const [dailyError, setDailyError] = useState('')
  const dailyPollTimerRef = useRef<number | null>(null)
  const loadDailyReportRef = useRef<((attempt?: number) => Promise<void>) | null>(null)

  const [repoInput, setRepoInput] = useState('facebook/react')
  const [repoAnalysis, setRepoAnalysis] = useState<RepoAnalysis | null>(null)
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [repoStatusMessage, setRepoStatusMessage] = useState('')
  const [repoError, setRepoError] = useState('')
  const [isAnalyzingRepo, setIsAnalyzingRepo] = useState(false)
  const repoPollTimerRef = useRef<number | null>(null)
  const pollRepoStatusRef = useRef<((owner: string, repo: string, attempt?: number) => Promise<void>) | null>(null)

  const selectedModule = useMemo(() => {
    if (!repoAnalysis) return null
    return repoAnalysis.modules.find((module) => module.id === selectedModuleId) ?? repoAnalysis.modules[0] ?? null
  }, [repoAnalysis, selectedModuleId])

  const loadDailyReport = useCallback(async (attempt = 0): Promise<void> => {
    if (dailyPollTimerRef.current) {
      window.clearTimeout(dailyPollTimerRef.current)
      dailyPollTimerRef.current = null
    }

    setIsLoadingDaily(attempt === 0)
    setDailyError('')

    try {
      const response = await fetch(buildApiUrl('/api/daily-report'))
      const data = (await response.json()) as DailyApiResponse

      if (data.status === 'ready') {
        setReport(data.report)
        setIsFallback(false)
        setDailyStatusMessage(`Report ready from ${data.source}.`)
        return
      }

      if (data.fallbackReport) {
        setReport(data.fallbackReport)
        setIsFallback(true)
      }

      setDailyStatusMessage(data.message)

      if (data.status === 'generating' && attempt < maxDailyPollAttempts) {
        dailyPollTimerRef.current = window.setTimeout(() => {
          void loadDailyReportRef.current?.(attempt + 1)
        }, pollDelayMs)
      }

      if (data.status === 'error') {
        setDailyError(data.message)
      }
    } catch (caughtError) {
      setDailyError(caughtError instanceof Error ? caughtError.message : 'Unable to load daily report.')
    } finally {
      setIsLoadingDaily(false)
    }
  }, [])

  const fetchRepoAnalysis = useCallback(async (owner: string, repo: string): Promise<RepoAnalysis | null> => {
    const response = await fetch(buildApiUrl(`/api/repos/${owner}/${repo}/analysis`))
    const data = (await response.json()) as RepoAnalysisResponse

    if (data.status !== 'ready') {
      setRepoStatusMessage(data.message)
      return null
    }

    return data.analysis
  }, [])

  const pollRepoStatus = useCallback(
    async (owner: string, repo: string, attempt = 0): Promise<void> => {
      if (repoPollTimerRef.current) {
        window.clearTimeout(repoPollTimerRef.current)
        repoPollTimerRef.current = null
      }

      try {
        const response = await fetch(buildApiUrl(`/api/repos/${owner}/${repo}/status`))
        const data = (await response.json()) as RepoStatusResponse
        setRepoStatusMessage(data.message)

        if (data.status === 'ready') {
          const analysis = await fetchRepoAnalysis(owner, repo)
          if (analysis) {
            setRepoAnalysis(analysis)
            setSelectedModuleId(analysis.modules[0]?.id ?? '')
            setRepoStatusMessage('Repository learning map is ready.')
          }
          return
        }

        if (data.status === 'error') {
          setRepoError(data.message)
          return
        }

        if (attempt < maxRepoPollAttempts) {
          repoPollTimerRef.current = window.setTimeout(() => {
            void pollRepoStatusRef.current?.(owner, repo, attempt + 1)
          }, pollDelayMs)
        } else {
          setRepoError('Analysis is still running. Please check again later.')
        }
      } catch (caughtError) {
        setRepoError(caughtError instanceof Error ? caughtError.message : 'Unable to poll repository analysis.')
      } finally {
        setIsAnalyzingRepo(false)
      }
    },
    [fetchRepoAnalysis],
  )

  async function startRepoAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (repoPollTimerRef.current) {
      window.clearTimeout(repoPollTimerRef.current)
      repoPollTimerRef.current = null
    }

    setMode('repo')
    setIsAnalyzingRepo(true)
    setRepoError('')
    setRepoStatusMessage('Starting repository analysis...')

    try {
      const response = await fetch(buildApiUrl('/api/repos/analyze'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: repoInput }),
      })
      const data = (await response.json()) as RepoAnalyzeResponse

      if (data.status === 'ready') {
        setRepoAnalysis(data.analysis)
        setSelectedModuleId(data.analysis.modules[0]?.id ?? '')
        setRepoStatusMessage('Repository learning map loaded from cache.')
        return
      }

      if (data.status === 'generating') {
        setRepoStatusMessage(data.message)
        repoPollTimerRef.current = window.setTimeout(() => {
          void pollRepoStatusRef.current?.(data.owner, data.repo, 0)
        }, pollDelayMs)
        return
      }

      setRepoError(data.message)
    } catch (caughtError) {
      setRepoError(caughtError instanceof Error ? caughtError.message : 'Unable to start repository analysis.')
    } finally {
      setIsAnalyzingRepo(false)
    }
  }

  useEffect(() => {
    loadDailyReportRef.current = loadDailyReport
  }, [loadDailyReport])

  useEffect(() => {
    pollRepoStatusRef.current = pollRepoStatus
  }, [pollRepoStatus])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadDailyReport()
    }, 0)

    return () => {
      window.clearTimeout(initialTimer)
      if (dailyPollTimerRef.current) window.clearTimeout(dailyPollTimerRef.current)
      if (repoPollTimerRef.current) window.clearTimeout(repoPollTimerRef.current)
    }
  }, [loadDailyReport])

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">GitHub intelligence workspace</p>
          <h1 id="page-title">Discover hot repos, then learn their architecture.</h1>
          <p className="lede">
            Daily signals identify interesting projects. Repository learning maps turn
            any project into a structured architecture view, module guide, and reading path.
          </p>
        </div>

        <div className="action-panel">
          <div className="mode-switch" aria-label="Workspace mode">
            <button type="button" className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>
              Daily brief
            </button>
            <button type="button" className={mode === 'repo' ? 'active' : ''} onClick={() => setMode('repo')}>
              Repo map
            </button>
          </div>

          {mode === 'daily' ? (
            <>
              <button className="primary-action" type="button" onClick={() => loadDailyReport()} disabled={isLoadingDaily}>
                {isLoadingDaily ? 'Checking report...' : 'Check Today Report'}
              </button>
              <p>
                {report
                  ? `Report date: ${report.dateKey} (${report.timezone})`
                  : 'Today report will appear here once ready.'}
              </p>
              {report && <span>Generated {formatDateTime(report.generatedAt)}</span>}
              {isFallback && <span className="status-warn">Showing latest completed report while today is generating.</span>}
              {dailyStatusMessage && <span>{dailyStatusMessage}</span>}
            </>
          ) : (
            <form className="repo-form" onSubmit={startRepoAnalysis}>
              <label htmlFor="repo-input">Repository</label>
              <div>
                <input
                  id="repo-input"
                  value={repoInput}
                  onChange={(event) => setRepoInput(event.target.value)}
                  placeholder="owner/repo or GitHub URL"
                />
                <button className="primary-action" type="submit" disabled={isAnalyzingRepo}>
                  {isAnalyzingRepo ? 'Analyzing...' : 'Analyze'}
                </button>
              </div>
              {repoStatusMessage && <span>{repoStatusMessage}</span>}
            </form>
          )}
        </div>
      </section>

      {mode === 'daily' ? (
        <DailyBrief
          error={dailyError}
          report={report}
        />
      ) : (
        <RepoLearningMap
          error={repoError}
          analysis={repoAnalysis}
          selectedModule={selectedModule}
          onSelectModule={setSelectedModuleId}
        />
      )}
    </main>
  )
}

function DailyBrief({ error, report }: { error: string; report: DailyReport | null }) {
  if (error) {
    return <div className="notice error">{error}</div>
  }

  if (!report) {
    return (
      <section className="empty-state" aria-label="Empty state">
        <h2>Preparing the first brief</h2>
        <p>
          If today has no cache yet, the Worker starts a background run and this page
          will poll for the finished report.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="brief" aria-label="Daily analysis">
        <div>
          <p className="section-kicker">Daily brief</p>
          <h2>{report.analysis.overview}</h2>
        </div>

        <div className="brief-grid">
          <SignalGroup title="Market signals" items={report.analysis.marketSignals} />
          <SignalGroup title="Patterns" items={report.analysis.notablePatterns} />
          <SignalGroup title="Risks" items={report.analysis.risks} />
          <SignalGroup title="Next moves" items={report.analysis.recommendations} />
        </div>
      </section>

      <section className="repo-grid" aria-label="GitHub repository analysis">
        {report.repos.map((repo, index) => (
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

            <div className="repo-summary">
              <span>{repo.heuristicAnalysis.category}</span>
              <p>{repo.heuristicAnalysis.summary}</p>
            </div>

            <p className="analysis">{repo.heuristicAnalysis.whyWatch}</p>

            <div className="stat-row" aria-label="Repository stats">
              <span>{formatNumber.format(repo.stargazers_count)} stars</span>
              <span>{formatNumber.format(repo.forks_count)} forks</span>
              <span>{formatNumber.format(repo.open_issues_count)} issues</span>
              {repo.trendRank && <span>Trending #{repo.trendRank}</span>}
            </div>

            <div className="signal-list" aria-label="Analysis signals">
              {repo.sources.slice(0, 4).map((source) => (
                <span key={source}>{sourceLabel(source)}</span>
              ))}
              {(repo.topics ?? []).slice(0, 3).map((topic) => (
                <span key={topic}>{topic}</span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </>
  )
}

function RepoLearningMap({
  error,
  analysis,
  selectedModule,
  onSelectModule,
}: {
  error: string
  analysis: RepoAnalysis | null
  selectedModule: RepoModule | null
  onSelectModule: (id: string) => void
}) {
  if (error) {
    return <div className="notice error">{error}</div>
  }

  if (!analysis) {
    return (
      <section className="empty-state" aria-label="Repository analysis empty state">
        <h2>Choose a repository to map</h2>
        <p>
          The Worker will inspect repository metadata, README content, tree structure,
          manifests, and key files, then cache the learning map by commit SHA.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="repo-overview" aria-label="Repository overview">
        <div>
          <p className="section-kicker">Repository learning map</p>
          <h2>
            <a href={analysis.htmlUrl} target="_blank" rel="noreferrer">
              {analysis.fullName}
            </a>
          </h2>
          <p>{analysis.overview.summary}</p>
        </div>

        <div className="overview-meta">
          <span>{analysis.overview.primaryLanguage}</span>
          <span>{analysis.overview.difficulty}</span>
          <span>{analysis.source.llm === 'openai' ? 'LLM enriched' : 'Heuristic'}</span>
          <span>{analysis.source.fileCount} files</span>
        </div>
      </section>

      <section className="learning-layout" aria-label="Repository architecture workspace">
        <aside className="module-nav" aria-label="Architecture branches">
          <h3>Branches</h3>
          {analysis.modules.map((module) => (
            <button
              key={module.id}
              className={selectedModule?.id === module.id ? 'active' : ''}
              type="button"
              onClick={() => onSelectModule(module.id)}
            >
              <span>{module.name}</span>
              <small>{module.keyFiles.length} key files</small>
            </button>
          ))}
        </aside>

        <div className="architecture-workspace">
          <ArchitectureMap
            nodes={analysis.architecture.nodes}
            edges={analysis.architecture.edges}
            selectedModuleId={selectedModule?.id ?? ''}
            onSelectModule={onSelectModule}
          />

          {selectedModule && <ModuleDetail module={selectedModule} />}
        </div>
      </section>

      <section className="learning-path" aria-label="Learning path">
        <div>
          <p className="section-kicker">Reading path</p>
          <h2>Learn the project in layers</h2>
        </div>
        <div className="path-grid">
          {analysis.learningPath.map((step) => (
            <article className="path-step" key={step.id}>
              <div>
                <span>{step.duration}</span>
                <h3>{step.title}</h3>
              </div>
              <p>{step.goal}</p>
              <FileList title="Files" files={step.files} />
              <ul>
                {step.outcomes.map((outcome) => (
                  <li key={outcome}>{outcome}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="repo-detail-grid" aria-label="Repository implementation details">
        <SignalGroup title="Problem" items={[analysis.overview.problem]} />
        <SignalGroup title="Audience" items={analysis.overview.audience} />
        <SignalGroup title="Maintenance" items={analysis.overview.maintenanceSignals} />
        <SignalGroup title="Risks" items={analysis.risks} />
      </section>

      <section className="repo-detail-grid" aria-label="Runbook and key files">
        <SignalGroup title="Install" items={analysis.runbook.install.length ? analysis.runbook.install : ['No install command inferred']} />
        <SignalGroup title="Run" items={analysis.runbook.run.length ? analysis.runbook.run : ['No run command inferred']} />
        <SignalGroup title="Test" items={analysis.runbook.test.length ? analysis.runbook.test : ['No test command inferred']} />
        <SignalGroup title="Config files" items={analysis.runbook.configFiles.length ? analysis.runbook.configFiles.slice(0, 8) : ['No config file inferred']} />
      </section>

      <section className="key-file-strip" aria-label="Key files">
        <div>
          <p className="section-kicker">Key files</p>
          <h2>Files worth opening first</h2>
        </div>
        <div className="key-file-grid">
          {analysis.keyFiles.slice(0, 12).map((file) => (
            <article className="key-file" key={file.path}>
              <span>{file.role}</span>
              <strong>{file.path}</strong>
              <p>{file.excerpt || 'No excerpt available.'}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function ArchitectureMap({
  nodes,
  edges,
  selectedModuleId,
  onSelectModule,
}: {
  nodes: ArchitectureNode[]
  edges: ArchitectureEdge[]
  selectedModuleId: string
  onSelectModule: (id: string) => void
}) {
  const moduleNodes = nodes.filter((node) => node.id !== 'overview')
  const overview = nodes.find((node) => node.id === 'overview')

  return (
    <section className="architecture-map" aria-label="Global architecture view">
      <div className="map-header">
        <div>
          <p className="section-kicker">Global architecture</p>
          <h2>{overview?.label ?? 'Repository Overview'}</h2>
        </div>
        <span>{nodes.length} nodes</span>
      </div>

      <div className="map-canvas">
        {overview && (
          <button
            type="button"
            className="architecture-node overview-node"
            onClick={() => undefined}
          >
            <span>{overview.label}</span>
            <small>{overview.fileCount} files mapped</small>
          </button>
        )}

        <div className="node-grid">
          {moduleNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`architecture-node ${selectedModuleId === node.id ? 'active' : ''}`}
              onClick={() => onSelectModule(node.id)}
            >
              <span>{node.label}</span>
              <small>
                {node.fileCount} files / {Math.round(node.confidence * 100)}% confidence
              </small>
            </button>
          ))}
        </div>
      </div>

      <div className="edge-list" aria-label="Architecture relationships">
        {edges.slice(0, 12).map((edge) => (
          <span key={`${edge.from}-${edge.to}-${edge.label}`}>
            {edge.from}
            {' -> '}
            {edge.to}: {edge.label}
          </span>
        ))}
      </div>
    </section>
  )
}

function ModuleDetail({ module }: { module: RepoModule }) {
  return (
    <section className="module-detail" aria-label="Selected architecture branch">
      <div>
        <p className="section-kicker">Selected branch</p>
        <h2>{module.name}</h2>
        <p>{module.purpose}</p>
      </div>

      <div className="module-detail-grid">
        <FileList title="Reading order" files={module.readingOrder} />
        <FileList title="Key files" files={module.keyFiles} />
        <SignalGroup title="Depends on" items={module.dependencies.length ? module.dependencies : ['No direct dependency inferred']} />
        <SignalGroup title="Used by" items={module.usedBy.length ? module.usedBy : ['No upstream module inferred']} />
      </div>

      <div className="branch-list">
        {module.branches.map((branch) => (
          <article key={branch.id}>
            <h3>{branch.name}</h3>
            <p>{branch.summary}</p>
            <FileList title="Files" files={branch.files} />
          </article>
        ))}
      </div>
    </section>
  )
}

function FileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="file-list">
      <h3>{title}</h3>
      {files.length > 0 ? (
        <ul>
          {files.slice(0, 10).map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      ) : (
        <p>No files inferred.</p>
      )}
    </div>
  )
}

function SignalGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="signal-group">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  )
}

export default App
