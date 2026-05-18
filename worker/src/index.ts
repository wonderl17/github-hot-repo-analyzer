type Env = {
  DAILY_REPORT_CACHE: KVNamespace
  GITHUB_TOKEN?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  ALLOWED_ORIGIN?: string
  REPORT_CACHE_TTL_SECONDS?: string
  REPORT_REPO_COUNT?: string
  REPORT_TIMEZONE?: string
  REPO_ANALYSIS_CACHE_TTL_SECONDS?: string
  REPO_FILE_SAMPLE_LIMIT?: string
}

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
  pushed_at: string | null
  default_branch?: string
  size?: number
  archived?: boolean
  disabled?: boolean
  license?: { spdx_id: string | null; name: string | null } | null
  owner: {
    login: string
    avatar_url: string
  }
}

type GitHubSearchResponse = {
  total_count: number
  items: SearchRepo[]
}

type GitHubBranchResponse = {
  name: string
  commit: {
    sha: string
  }
}

type GitHubTreeEntry = {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
  url: string
}

type GitHubTreeResponse = {
  sha: string
  truncated: boolean
  tree: GitHubTreeEntry[]
}

type GitHubContentResponse = {
  type: string
  encoding?: string
  size: number
  content?: string
  name: string
  path: string
}

type CandidateRepo = SearchRepo & {
  readmeExcerpt: string
  sources: string[]
  trendRank?: number
  signalScore: number
  heuristicAnalysis: RepoInsight
}

type RepoInsight = {
  summary: string
  category: string
  whyWatch: string
  risks: string[]
  action: 'try' | 'watch' | 'skip'
}

type LlmReport = {
  overview: string
  marketSignals: string[]
  notablePatterns: string[]
  risks: string[]
  recommendations: string[]
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
  analysis: LlmReport
  repos: CandidateRepo[]
}

type DailyReportApiResponse =
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

type RepoStatus = {
  status: 'generating' | 'ready' | 'error'
  owner: string
  repo: string
  commitSha?: string
  message: string
  startedAt?: string
  completedAt?: string
  analysisKey?: string
  generatedAt?: string
}

type RepoAnalysisApiResponse =
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

type SampledFile = {
  path: string
  content: string
  size: number
}

type RepoContext = {
  repo: SearchRepo
  branch: GitHubBranchResponse
  tree: GitHubTreeResponse
  readmeExcerpt: string
  languages: Record<string, number>
  sampledFiles: SampledFile[]
  manifestFiles: SampledFile[]
}

const dailyCachePrefix = 'daily-report'
const dailyLastSuccessKey = `${dailyCachePrefix}:last-success`
const repoCachePrefix = 'repo-analysis'
const repoAnalysisVersion = 1

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) })
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({ ok: true, service: 'github-hot-repo-analyzer-api' }, request, env)
    }

    if (url.pathname === '/api/daily-report') {
      if (request.method !== 'GET') {
        return jsonResponse({ message: 'Method not allowed' }, request, env, 405)
      }
      return handleDailyReport(request, env, ctx)
    }

    if (url.pathname === '/api/repos/analyze') {
      if (request.method !== 'POST') {
        return jsonResponse({ message: 'Method not allowed' }, request, env, 405)
      }
      return handleRepoAnalyze(request, env, ctx)
    }

    const repoRoute = parseRepoRoute(url.pathname)
    if (repoRoute) {
      if (request.method !== 'GET') {
        return jsonResponse({ message: 'Method not allowed' }, request, env, 405)
      }
      return handleRepoReadRoute(request, env, repoRoute)
    }

    return jsonResponse({ message: 'Not found' }, request, env, 404)
  },
}

async function handleDailyReport(request: Request, env: Env, ctx: ExecutionContext) {
  const timezone = env.REPORT_TIMEZONE || 'Asia/Hong_Kong'
  const dateKey = getDateKey(timezone)
  const reportKey = `${dailyCachePrefix}:${dateKey}:report`
  const lockKey = `${dailyCachePrefix}:${dateKey}:lock`

  const cachedReport = await readJson<DailyReport>(env, reportKey)
  if (cachedReport) {
    return jsonResponse<DailyReportApiResponse>(
      {
        status: 'ready',
        source: 'cache',
        dateKey,
        generatedAt: cachedReport.generatedAt,
        report: cachedReport,
      },
      request,
      env,
    )
  }

  const fallbackReport = await readJson<DailyReport>(env, dailyLastSuccessKey)
  const existingLock = await env.DAILY_REPORT_CACHE.get(lockKey)
  if (existingLock) {
    return jsonResponse<DailyReportApiResponse>(
      {
        status: 'generating',
        dateKey,
        message: 'Today report is being generated. Please retry shortly.',
        fallbackReport: fallbackReport ?? undefined,
      },
      request,
      env,
      202,
    )
  }

  const lockId = crypto.randomUUID()
  await env.DAILY_REPORT_CACHE.put(lockKey, lockId, { expirationTtl: 900 })
  ctx.waitUntil(generateAndStoreDailyReport(env, dateKey, timezone, reportKey, lockKey, lockId))

  return jsonResponse<DailyReportApiResponse>(
    {
      status: 'generating',
      dateKey,
      message: 'Today report generation has started. Please retry shortly.',
      fallbackReport: fallbackReport ?? undefined,
    },
    request,
    env,
    202,
  )
}

async function handleRepoAnalyze(request: Request, env: Env, ctx: ExecutionContext) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return jsonResponse<RepoAnalysisApiResponse>(
      { status: 'error', message: 'Request body must be JSON.' },
      request,
      env,
      400,
    )
  }

  const parsed = parseRepoInput(input)
  if (!parsed) {
    return jsonResponse<RepoAnalysisApiResponse>(
      { status: 'error', message: 'Provide a GitHub repo URL or owner/repo pair.' },
      request,
      env,
      400,
    )
  }

  try {
    const repo = await fetchRepositoryOrThrow(env, `${parsed.owner}/${parsed.repo}`)
    const branch = await fetchDefaultBranch(env, repo)
    const repoKey = normalizeRepoKey(repo.full_name)
    const analysisKey = getRepoAnalysisKey(repoKey, branch.commit.sha)
    const statusKey = getRepoStatusKey(repoKey)
    const lockKey = getRepoLockKey(repoKey, branch.commit.sha)

    if (!parsed.force) {
      const cached = await readJson<RepoAnalysis>(env, analysisKey)
      if (cached) {
        await env.DAILY_REPORT_CACHE.put(
          getRepoLatestKey(repoKey),
          JSON.stringify({
            analysisKey,
            commitSha: branch.commit.sha,
            generatedAt: cached.generatedAt,
          }),
          { expirationTtl: repoAnalysisTtl(env) },
        )

        return jsonResponse<RepoAnalysisApiResponse>(
          {
            status: 'ready',
            owner: repo.owner.login,
            repo: repo.name,
            commitSha: branch.commit.sha,
            source: 'cache',
            analysis: cached,
          },
          request,
          env,
        )
      }
    }

    const existingLock = await env.DAILY_REPORT_CACHE.get(lockKey)
    if (existingLock) {
      return jsonResponse<RepoAnalysisApiResponse>(
        {
          status: 'generating',
          owner: repo.owner.login,
          repo: repo.name,
          commitSha: branch.commit.sha,
          message: 'Repository analysis is already running.',
          statusUrl: `/api/repos/${repo.owner.login}/${repo.name}/status`,
        },
        request,
        env,
        202,
      )
    }

    const lockId = crypto.randomUUID()
    const status: RepoStatus = {
      status: 'generating',
      owner: repo.owner.login,
      repo: repo.name,
      commitSha: branch.commit.sha,
      message: 'Repository analysis has started.',
      startedAt: new Date().toISOString(),
      analysisKey,
    }

    await env.DAILY_REPORT_CACHE.put(lockKey, lockId, { expirationTtl: 1200 })
    await env.DAILY_REPORT_CACHE.put(statusKey, JSON.stringify(status), { expirationTtl: repoAnalysisTtl(env) })
    ctx.waitUntil(generateAndStoreRepoAnalysis(env, repo, branch, analysisKey, statusKey, lockKey, lockId))

    return jsonResponse<RepoAnalysisApiResponse>(
      {
        status: 'generating',
        owner: repo.owner.login,
        repo: repo.name,
        commitSha: branch.commit.sha,
        message: 'Repository analysis has started.',
        statusUrl: `/api/repos/${repo.owner.login}/${repo.name}/status`,
      },
      request,
      env,
      202,
    )
  } catch (error) {
    return jsonResponse<RepoAnalysisApiResponse>(
      {
        status: 'error',
        owner: parsed.owner,
        repo: parsed.repo,
        message: error instanceof Error ? error.message : 'Unable to start repository analysis.',
      },
      request,
      env,
      500,
    )
  }
}

async function handleRepoReadRoute(
  request: Request,
  env: Env,
  route: { owner: string; repo: string; section: string; moduleId?: string },
) {
  const repoKey = normalizeRepoKey(`${route.owner}/${route.repo}`)
  const statusKey = getRepoStatusKey(repoKey)
  const status = await readJson<RepoStatus>(env, statusKey)
  const latest = await readJson<{ analysisKey: string; commitSha: string; generatedAt: string }>(
    env,
    getRepoLatestKey(repoKey),
  )
  const analysis = latest ? await readJson<RepoAnalysis>(env, latest.analysisKey) : null

  if (route.section === 'status') {
    return jsonResponse(
      {
        status: status?.status ?? (analysis ? 'ready' : 'missing'),
        owner: route.owner,
        repo: route.repo,
        commitSha: latest?.commitSha ?? status?.commitSha,
        generatedAt: latest?.generatedAt,
        message: status?.message ?? (analysis ? 'Latest analysis is ready.' : 'No analysis has been generated yet.'),
      },
      request,
      env,
      analysis || status ? 200 : 404,
    )
  }

  if (!analysis) {
    return jsonResponse(
      {
        status: status?.status ?? 'missing',
        owner: route.owner,
        repo: route.repo,
        message: status?.message ?? 'No analysis has been generated yet. Start one with POST /api/repos/analyze.',
      },
      request,
      env,
      status?.status === 'generating' ? 202 : 404,
    )
  }

  if (route.section === 'analysis') {
    return jsonResponse({ status: 'ready', analysis }, request, env)
  }

  if (route.section === 'architecture') {
    return jsonResponse({ status: 'ready', architecture: analysis.architecture }, request, env)
  }

  if (route.section === 'module' && route.moduleId) {
    const module = analysis.modules.find((item) => item.id === route.moduleId)
    if (!module) {
      return jsonResponse({ status: 'missing', message: 'Module not found.' }, request, env, 404)
    }

    return jsonResponse({ status: 'ready', module }, request, env)
  }

  return jsonResponse({ message: 'Not found' }, request, env, 404)
}

async function generateAndStoreDailyReport(
  env: Env,
  dateKey: string,
  timezone: string,
  reportKey: string,
  lockKey: string,
  lockId: string,
) {
  try {
    const currentLock = await env.DAILY_REPORT_CACHE.get(lockKey)
    if (currentLock !== lockId) {
      return
    }

    const report = await buildDailyReport(env, dateKey, timezone)
    const ttl = toInt(env.REPORT_CACHE_TTL_SECONDS, 60 * 60 * 24 * 14)
    await env.DAILY_REPORT_CACHE.put(reportKey, JSON.stringify(report), { expirationTtl: ttl })
    await env.DAILY_REPORT_CACHE.put(dailyLastSuccessKey, JSON.stringify(report), { expirationTtl: ttl })
  } catch (error) {
    const errorKey = `${dailyCachePrefix}:${dateKey}:error`
    await env.DAILY_REPORT_CACHE.put(
      errorKey,
      JSON.stringify({
        message: error instanceof Error ? error.message : 'Unknown report generation error.',
        at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 },
    )
  } finally {
    const currentLock = await env.DAILY_REPORT_CACHE.get(lockKey)
    if (currentLock === lockId) {
      await env.DAILY_REPORT_CACHE.delete(lockKey)
    }
  }
}

async function generateAndStoreRepoAnalysis(
  env: Env,
  repo: SearchRepo,
  branch: GitHubBranchResponse,
  analysisKey: string,
  statusKey: string,
  lockKey: string,
  lockId: string,
) {
  const repoKey = normalizeRepoKey(repo.full_name)

  try {
    const currentLock = await env.DAILY_REPORT_CACHE.get(lockKey)
    if (currentLock !== lockId) {
      return
    }

    const analysis = await buildRepoAnalysis(env, repo, branch)
    const ttl = repoAnalysisTtl(env)
    await env.DAILY_REPORT_CACHE.put(analysisKey, JSON.stringify(analysis), { expirationTtl: ttl })
    await env.DAILY_REPORT_CACHE.put(
      getRepoLatestKey(repoKey),
      JSON.stringify({
        analysisKey,
        commitSha: branch.commit.sha,
        generatedAt: analysis.generatedAt,
      }),
      { expirationTtl: ttl },
    )
    await env.DAILY_REPORT_CACHE.put(
      statusKey,
      JSON.stringify({
        status: 'ready',
        owner: repo.owner.login,
        repo: repo.name,
        commitSha: branch.commit.sha,
        message: 'Repository analysis is ready.',
        completedAt: analysis.generatedAt,
        analysisKey,
        generatedAt: analysis.generatedAt,
      } satisfies RepoStatus),
      { expirationTtl: ttl },
    )
  } catch (error) {
    await env.DAILY_REPORT_CACHE.put(
      statusKey,
      JSON.stringify({
        status: 'error',
        owner: repo.owner.login,
        repo: repo.name,
        commitSha: branch.commit.sha,
        message: error instanceof Error ? error.message : 'Repository analysis failed.',
        completedAt: new Date().toISOString(),
        analysisKey,
      } satisfies RepoStatus),
      { expirationTtl: 60 * 60 },
    )
  } finally {
    const currentLock = await env.DAILY_REPORT_CACHE.get(lockKey)
    if (currentLock === lockId) {
      await env.DAILY_REPORT_CACHE.delete(lockKey)
    }
  }
}

async function buildDailyReport(env: Env, dateKey: string, timezone: string): Promise<DailyReport> {
  const repoCount = toInt(env.REPORT_REPO_COUNT, 10)
  const searchQueries = [
    `created:${dateKey} stars:>0 fork:false`,
    `created:${dateKey} forks:>0 fork:false`,
    `pushed:${dateKey} stars:>100 fork:false`,
  ]

  const allCandidates = new Map<string, SearchRepo & { sources: string[]; trendRank?: number }>()

  for (const query of searchQueries) {
    const sort = query.includes('forks:') ? 'forks' : 'stars'
    const repos = await searchRepositories(env, query, sort, 20)
    for (const repo of repos) {
      mergeCandidate(allCandidates, repo, query)
    }
  }

  const trendingNames = await fetchTrendingNames()
  for (const trending of trendingNames.slice(0, 12)) {
    const repo = await fetchRepository(env, trending.fullName)
    if (repo) {
      mergeCandidate(allCandidates, repo, 'github-trending')
      const candidate = allCandidates.get(repo.full_name)
      if (candidate) {
        candidate.trendRank = trending.rank
      }
    }
  }

  const rankedRepos = [...allCandidates.values()]
    .map((repo) => ({
      ...repo,
      signalScore: scoreRepo(repo),
    }))
    .sort((left, right) => right.signalScore - left.signalScore)
    .slice(0, repoCount)

  const repos: CandidateRepo[] = []
  for (const repo of rankedRepos) {
    const readmeExcerpt = await fetchReadme(env, repo.owner.login, repo.name)
    repos.push({
      ...repo,
      readmeExcerpt,
      heuristicAnalysis: analyzeRepo(repo, readmeExcerpt),
    })
  }

  const llmAnalysis = await analyzeReportWithLlm(env, repos)

  return {
    dateKey,
    generatedAt: new Date().toISOString(),
    timezone,
    repoCount: repos.length,
    sources: {
      githubSearch: searchQueries,
      githubTrending: 'https://github.com/trending?since=daily',
      llm: env.OPENAI_API_KEY ? 'openai' : 'heuristic',
    },
    analysis: llmAnalysis,
    repos,
  }
}

async function buildRepoAnalysis(env: Env, repo: SearchRepo, branch: GitHubBranchResponse): Promise<RepoAnalysis> {
  const context = await collectRepoContext(env, repo, branch)
  const baseline = buildHeuristicRepoAnalysis(context)
  return enrichRepoAnalysisWithLlm(env, baseline, context)
}

async function collectRepoContext(env: Env, repo: SearchRepo, branch: GitHubBranchResponse): Promise<RepoContext> {
  const [tree, readmeExcerpt, languages] = await Promise.all([
    fetchRepoTree(env, repo.owner.login, repo.name, branch.commit.sha),
    fetchReadme(env, repo.owner.login, repo.name),
    fetchLanguages(env, repo.owner.login, repo.name),
  ])

  const fileEntries = tree.tree.filter((entry) => entry.type === 'blob')
  const keyPaths = pickKeyFilePaths(fileEntries, toInt(env.REPO_FILE_SAMPLE_LIMIT, 24))
  const sampledFiles: SampledFile[] = []

  for (const path of keyPaths) {
    const content = await fetchFileContent(env, repo.owner.login, repo.name, path, repo.default_branch || branch.name)
    if (content) {
      sampledFiles.push(content)
    }
  }

  const manifestFiles = sampledFiles.filter((file) => isManifestPath(file.path))

  return {
    repo,
    branch,
    tree,
    readmeExcerpt,
    languages,
    sampledFiles,
    manifestFiles,
  }
}

function buildHeuristicRepoAnalysis(context: RepoContext): RepoAnalysis {
  const fileEntries = context.tree.tree.filter((entry) => entry.type === 'blob')
  const groups = buildArchitectureGroups(fileEntries)
  const nodes = buildArchitectureNodes(groups)
  const edges = buildArchitectureEdges(nodes)
  const modules = buildRepoModules(groups, edges)
  const keyFiles = buildKeyFiles(context.sampledFiles, modules)
  const runbook = buildRunbook(context.manifestFiles, fileEntries)
  const techStack = inferTechStack(context)
  const difficulty = inferDifficulty(fileEntries.length, modules.length, context.tree.truncated)
  const summarySource = compactSummary(context.repo.description || context.readmeExcerpt || 'No public summary is available yet.')

  return {
    analysisVersion: repoAnalysisVersion,
    owner: context.repo.owner.login,
    repo: context.repo.name,
    fullName: context.repo.full_name,
    htmlUrl: context.repo.html_url,
    defaultBranch: context.repo.default_branch || context.branch.name,
    commitSha: context.branch.commit.sha,
    generatedAt: new Date().toISOString(),
    source: {
      llm: 'heuristic',
      treeTruncated: context.tree.truncated,
      fileCount: fileEntries.length,
      sampledFileCount: context.sampledFiles.length,
    },
    overview: {
      summary: summarySource,
      problem: inferProblem(context),
      techStack,
      primaryLanguage: context.repo.language || 'Unknown',
      languages: context.languages,
      difficulty,
      audience: inferAudience(context, techStack),
      maintenanceSignals: buildMaintenanceSignals(context.repo, context.tree.truncated),
    },
    architecture: {
      nodes,
      edges,
    },
    modules,
    learningPath: buildLearningPath(modules, keyFiles, runbook),
    keyFiles,
    runbook,
    risks: buildRepoRisks(context, modules),
  }
}

async function enrichRepoAnalysisWithLlm(
  env: Env,
  baseline: RepoAnalysis,
  context: RepoContext,
): Promise<RepoAnalysis> {
  if (!env.OPENAI_API_KEY) {
    return baseline
  }

  const model = env.OPENAI_MODEL || 'gpt-4.1-mini'
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const compactFiles = context.sampledFiles.slice(0, 16).map((file) => ({
    path: file.path,
    excerpt: compactRepeatedWords(stripMarkdown(file.content)).slice(0, 900),
  }))

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You analyze open-source repositories for learning. Return JSON only. Use concise Simplified Chinese text. Required keys: summary, problem, audience, architectureNotes, modulePurpose, learningPathNotes, risks. modulePurpose is an object keyed by module id.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              repo: {
                fullName: baseline.fullName,
                description: context.repo.description,
                language: context.repo.language,
                topics: context.repo.topics ?? [],
                readmeExcerpt: context.readmeExcerpt.slice(0, 1800),
              },
              baselineModules: baseline.modules.map((module) => ({
                id: module.id,
                name: module.name,
                keyFiles: module.keyFiles.slice(0, 8),
                directories: module.directories.slice(0, 8),
              })),
              sampledFiles: compactFiles,
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM request failed with status ${response.status}.`)
    }

    const data = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('LLM response did not include content.')
    }

    const parsed = JSON.parse(content)
    if (!isRecord(parsed)) {
      return baseline
    }

    const modulePurpose = isRecord(parsed.modulePurpose) ? parsed.modulePurpose : {}
    const modules = baseline.modules.map((module) => ({
      ...module,
      purpose: asString(modulePurpose[module.id]) || module.purpose,
    }))

    return {
      ...baseline,
      source: {
        ...baseline.source,
        llm: 'openai',
      },
      overview: {
        ...baseline.overview,
        summary: asString(parsed.summary) || baseline.overview.summary,
        problem: asString(parsed.problem) || baseline.overview.problem,
        audience: asStringList(parsed.audience).length > 0 ? asStringList(parsed.audience) : baseline.overview.audience,
      },
      architecture: {
        ...baseline.architecture,
        nodes: baseline.architecture.nodes.map((node) => ({
          ...node,
          summary:
            node.id === 'overview'
              ? asString(parsed.architectureNotes) || node.summary
              : node.summary,
        })),
      },
      modules,
      learningPath: applyLearningPathNotes(baseline.learningPath, asStringList(parsed.learningPathNotes)),
      risks: asStringList(parsed.risks).length > 0 ? asStringList(parsed.risks) : baseline.risks,
    }
  } catch {
    return baseline
  }
}

async function searchRepositories(env: Env, query: string, sort: string, perPage: number) {
  const params = new URLSearchParams({
    q: query,
    sort,
    order: 'desc',
    per_page: String(perPage),
  })
  const data = await githubFetch<GitHubSearchResponse>(
    env,
    `https://api.github.com/search/repositories?${params.toString()}`,
  )
  return data.items
}

async function fetchRepository(env: Env, fullName: string) {
  try {
    return await fetchRepositoryOrThrow(env, fullName)
  } catch {
    return null
  }
}

async function fetchRepositoryOrThrow(env: Env, fullName: string) {
  return githubFetch<SearchRepo>(env, `https://api.github.com/repos/${encodeRepoFullName(fullName)}`)
}

async function fetchDefaultBranch(env: Env, repo: SearchRepo) {
  const branch = encodeURIComponent(repo.default_branch || 'main')
  return githubFetch<GitHubBranchResponse>(
    env,
    `https://api.github.com/repos/${encodeRepoFullName(repo.full_name)}/branches/${branch}`,
  )
}

async function fetchRepoTree(env: Env, owner: string, repo: string, sha: string) {
  return githubFetch<GitHubTreeResponse>(
    env,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
  )
}

async function fetchLanguages(env: Env, owner: string, repo: string) {
  try {
    return githubFetch<Record<string, number>>(env, `https://api.github.com/repos/${owner}/${repo}/languages`)
  } catch {
    return {}
  }
}

async function fetchReadme(env: Env, owner: string, repo: string) {
  try {
    const data = await githubFetch<{ content: string }>(
      env,
      `https://api.github.com/repos/${owner}/${repo}/readme`,
    )
    return compactRepeatedWords(stripMarkdown(decodeBase64(data.content))).slice(0, 1800)
  } catch {
    return ''
  }
}

async function fetchFileContent(env: Env, owner: string, repo: string, path: string, ref: string) {
  try {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const data = await githubFetch<GitHubContentResponse>(
      env,
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    )

    if (data.type !== 'file' || !data.content || data.encoding !== 'base64' || data.size > 80_000) {
      return null
    }

    return {
      path: data.path,
      content: decodeBase64(data.content),
      size: data.size,
    } satisfies SampledFile
  } catch {
    return null
  }
}

async function fetchTrendingNames() {
  try {
    const response = await fetch('https://github.com/trending?since=daily', {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'github-hot-repo-analyzer',
      },
    })
    if (!response.ok) {
      return []
    }

    const html = await response.text()
    const repos: Array<{ fullName: string; rank: number }> = []
    const seen = new Set<string>()
    const repoLinkPattern = /<h2[^>]*>[\s\S]*?<a\s+href="\/([^"?#]+\/[^"?#]+)"[\s\S]*?<\/a>/g
    let match: RegExpExecArray | null

    while ((match = repoLinkPattern.exec(html)) && repos.length < 25) {
      const fullName = match[1].replace(/\s/g, '')
      if (!seen.has(fullName)) {
        seen.add(fullName)
        repos.push({ fullName, rank: repos.length + 1 })
      }
    }

    return repos
  } catch {
    return []
  }
}

async function githubFetch<T>(env: Env, url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-hot-repo-analyzer',
  }

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const reset = response.headers.get('x-ratelimit-reset')
    const details = reset ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.` : ''
    throw new Error(`GitHub request failed with status ${response.status}.${details}`)
  }

  return response.json() as Promise<T>
}

async function analyzeReportWithLlm(env: Env, repos: CandidateRepo[]): Promise<LlmReport> {
  if (!env.OPENAI_API_KEY) {
    return buildHeuristicReport(repos)
  }

  const model = env.OPENAI_MODEL || 'gpt-4.1-mini'
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const compactRepos = repos.map((repo) => ({
    full_name: repo.full_name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    open_issues: repo.open_issues_count,
    topics: repo.topics ?? [],
    created_at: repo.created_at,
    pushed_at: repo.pushed_at,
    sources: repo.sources,
    trend_rank: repo.trendRank,
    readme_excerpt: repo.readmeExcerpt.slice(0, 700),
  }))

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You analyze GitHub open-source trend data. Return concise Simplified Chinese JSON only with keys: overview, marketSignals, notablePatterns, risks, recommendations. Each list should contain 3-5 short strings.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Generate a daily GitHub trend intelligence brief.',
              repos: compactRepos,
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM request failed with status ${response.status}.`)
    }

    const data = await response.json<{
      choices?: Array<{ message?: { content?: string } }>
    }>()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('LLM response did not include content.')
    }

    return normalizeLlmReport(JSON.parse(content))
  } catch {
    return buildHeuristicReport(repos)
  }
}

function normalizeLlmReport(value: unknown): LlmReport {
  const fallback = buildHeuristicReport([])
  if (!isRecord(value)) {
    return fallback
  }

  return {
    overview: asString(value.overview) || fallback.overview,
    marketSignals: asStringList(value.marketSignals),
    notablePatterns: asStringList(value.notablePatterns),
    risks: asStringList(value.risks),
    recommendations: asStringList(value.recommendations),
  }
}

function buildHeuristicReport(repos: CandidateRepo[]): LlmReport {
  const aiCount = repos.filter((repo) => repo.heuristicAnalysis.category.includes('AI')).length
  const devToolCount = repos.filter((repo) => repo.heuristicAnalysis.category.includes('Developer')).length
  const trendingCount = repos.filter((repo) => repo.trendRank).length

  return {
    overview:
      repos.length > 0
        ? `Identified ${repos.length} high-signal repositories across new projects, active projects, and Trending signals.`
        : 'No effective repository data has been generated yet.',
    marketSignals: [
      `AI or LLM related projects: ${aiCount}`,
      `Developer tooling projects: ${devToolCount}`,
      `Projects seen on GitHub Trending: ${trendingCount}`,
    ],
    notablePatterns: [
      'Ranking combines stars, forks, Trending rank, README context, and source diversity.',
      'New repositories and active mature repositories both enter the candidate pool.',
      'Projects with missing README or weak descriptions are harder to interpret.',
    ],
    risks: [
      'GitHub Trending has no stable official JSON API, so Trending is parsed as a best-effort signal.',
      'Stars and forks are lagging indicators and do not prove real adoption by themselves.',
      'GitHub API rate limits can affect report completeness.',
    ],
    recommendations: [
      'Prioritize projects with strong README quality and clear early adoption signals.',
      'Watch repositories that appear repeatedly across multiple signal sources.',
      'Add historical snapshots before making 24-hour growth claims.',
    ],
  }
}

function analyzeRepo(repo: SearchRepo, readmeExcerpt: string): RepoInsight {
  const text = `${repo.name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')} ${readmeExcerpt}`.toLowerCase()
  const categoryRules = [
    {
      category: 'AI application or agent tooling',
      words: ['ai', 'agent', 'llm', 'model', 'rag', 'openai', 'chatbot', 'inference'],
    },
    {
      category: 'Developer tool or framework',
      words: ['cli', 'framework', 'sdk', 'api', 'toolkit', 'library', 'developer', 'typescript'],
    },
    {
      category: 'Data, analytics, or automation project',
      words: ['data', 'analytics', 'pipeline', 'crawler', 'scraper', 'automation', 'dashboard'],
    },
    {
      category: 'Frontend, UI, or design system',
      words: ['react', 'vue', 'component', 'ui', 'css', 'tailwind', 'design', 'frontend'],
    },
    {
      category: 'Infrastructure or DevOps utility',
      words: ['docker', 'kubernetes', 'deploy', 'server', 'cloud', 'database', 'monitoring'],
    },
  ]

  const matchedCategory =
    categoryRules.find((rule) => rule.words.some((word) => text.includes(word)))?.category ??
    'New open source project'
  const summary = compactSummary(repo.description?.trim() || readmeExcerpt || 'No public summary is available yet.')
  const risks = []
  if (!repo.description) {
    risks.push('Missing repository description')
  }
  if (!readmeExcerpt) {
    risks.push('README unavailable or too small')
  }
  if (repo.stargazers_count < 20 && !repo.pushed_at) {
    risks.push('Weak early adoption signal')
  }

  return {
    summary,
    category: matchedCategory,
    whyWatch:
      repo.stargazers_count >= 100
        ? 'Strong early star signal.'
        : 'Worth monitoring if the topic matches your watchlist.',
    risks: risks.slice(0, 3),
    action: repo.stargazers_count >= 100 || repo.forks_count >= 20 ? 'try' : 'watch',
  }
}

function buildArchitectureGroups(fileEntries: GitHubTreeEntry[]) {
  const groupMap = new Map<ArchitectureKind, GitHubTreeEntry[]>()
  const kinds: ArchitectureKind[] = ['entry', 'interface', 'core', 'data', 'integration', 'infra', 'test', 'docs', 'build']
  for (const kind of kinds) {
    groupMap.set(kind, [])
  }

  for (const entry of fileEntries) {
    const kind = classifyPath(entry.path)
    groupMap.get(kind)?.push(entry)
  }

  return groupMap
}

function buildArchitectureNodes(groups: Map<ArchitectureKind, GitHubTreeEntry[]>): ArchitectureNode[] {
  const nodes: ArchitectureNode[] = [
    {
      id: 'overview',
      label: 'Repository Overview',
      kind: 'overview',
      summary: 'Top-level map of how this repository is organized for learning.',
      fileCount: [...groups.values()].reduce((total, entries) => total + entries.length, 0),
      keyFiles: [],
      directories: [],
      confidence: 0.9,
    },
  ]

  for (const [kind, entries] of groups.entries()) {
    if (entries.length === 0) {
      continue
    }

    nodes.push({
      id: kind,
      label: architectureLabel(kind),
      kind,
      summary: architectureSummary(kind),
      fileCount: entries.length,
      keyFiles: pickRepresentativePaths(entries, 8),
      directories: pickDirectories(entries, 8),
      confidence: inferGroupConfidence(kind, entries),
    })
  }

  return nodes
}

function buildArchitectureEdges(nodes: ArchitectureNode[]): ArchitectureEdge[] {
  const ids = new Set(nodes.map((node) => node.id))
  const edges: ArchitectureEdge[] = []
  const add = (from: string, to: string, label: string) => {
    if (ids.has(from) && ids.has(to)) {
      edges.push({ from, to, label })
    }
  }

  for (const node of nodes) {
    if (node.id !== 'overview') {
      add('overview', node.id, 'contains')
    }
  }

  add('entry', 'interface', 'routes to')
  add('entry', 'core', 'starts')
  add('interface', 'core', 'uses')
  add('core', 'data', 'reads/writes')
  add('core', 'integration', 'calls')
  add('test', 'core', 'validates')
  add('infra', 'entry', 'runs')
  add('build', 'entry', 'packages')
  add('docs', 'overview', 'explains')

  return edges
}

function buildRepoModules(
  groups: Map<ArchitectureKind, GitHubTreeEntry[]>,
  edges: ArchitectureEdge[],
): RepoModule[] {
  const modules: RepoModule[] = []

  for (const [kind, entries] of groups.entries()) {
    if (entries.length === 0) {
      continue
    }

    const id = kind
    modules.push({
      id,
      name: architectureLabel(kind),
      kind,
      purpose: architectureSummary(kind),
      directories: pickDirectories(entries, 10),
      keyFiles: pickRepresentativePaths(entries, 10),
      dependencies: edges.filter((edge) => edge.from === id).map((edge) => edge.to),
      usedBy: edges.filter((edge) => edge.to === id).map((edge) => edge.from),
      readingOrder: pickReadingOrder(kind, entries),
      branches: buildModuleBranches(id, entries),
      risks: buildModuleRisks(kind, entries),
    })
  }

  return modules
}

function buildModuleBranches(moduleId: string, entries: GitHubTreeEntry[]) {
  const byDirectory = new Map<string, GitHubTreeEntry[]>()
  for (const entry of entries) {
    const directory = topDirectory(entry.path)
    const current = byDirectory.get(directory) ?? []
    current.push(entry)
    byDirectory.set(directory, current)
  }

  return [...byDirectory.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 6)
    .map(([name, files]) => ({
      id: `${moduleId}:${slugify(name)}`,
      name,
      summary: `${files.length} files grouped under ${name}.`,
      files: pickRepresentativePaths(files, 8),
    }))
}

function buildKeyFiles(sampledFiles: SampledFile[], modules: RepoModule[]): KeyFile[] {
  return sampledFiles.slice(0, 24).map((file) => {
    const moduleId = classifyPath(file.path)
    const module = modules.find((item) => item.id === moduleId)

    return {
      path: file.path,
      role: inferFileRole(file.path),
      moduleId: module?.id ?? 'core',
      excerpt: compactRepeatedWords(stripMarkdown(file.content)).slice(0, 300),
    }
  })
}

function buildRunbook(manifestFiles: SampledFile[], fileEntries: GitHubTreeEntry[]) {
  const paths = new Set(fileEntries.map((entry) => entry.path))
  const packageFile = manifestFiles.find((file) => file.path.endsWith('package.json'))
  const scripts = packageFile ? readPackageScripts(packageFile.content) : {}
  const install: string[] = []
  const run: string[] = []
  const test: string[] = []

  if (packageFile) {
    install.push('npm install')
    if (scripts.dev) run.push('npm run dev')
    if (scripts.start) run.push('npm start')
    if (scripts.build) run.push('npm run build')
    if (scripts.test) test.push('npm test')
    if (scripts.lint) test.push('npm run lint')
  }

  if (paths.has('requirements.txt') || paths.has('pyproject.toml')) {
    install.push(paths.has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install -e .')
    run.push('python -m <module>')
    test.push('pytest')
  }

  if (paths.has('go.mod')) {
    install.push('go mod download')
    run.push('go run .')
    test.push('go test ./...')
  }

  if (paths.has('Cargo.toml')) {
    install.push('cargo fetch')
    run.push('cargo run')
    test.push('cargo test')
  }

  if (paths.has('Dockerfile')) {
    run.push('docker build -t repo-analysis .')
  }

  return {
    install: unique(install),
    run: unique(run),
    test: unique(test),
    configFiles: [...paths].filter((path) => isConfigPath(path)).slice(0, 20),
  }
}

function buildLearningPath(modules: RepoModule[], keyFiles: KeyFile[], runbook: RepoAnalysis['runbook']): LearningStep[] {
  const docsFiles = keyFiles.filter((file) => file.moduleId === 'docs').map((file) => file.path)
  const entryFiles = keyFiles.filter((file) => file.moduleId === 'entry').map((file) => file.path)
  const coreFiles = keyFiles.filter((file) => file.moduleId === 'core').map((file) => file.path)
  const testFiles = keyFiles.filter((file) => file.moduleId === 'test').map((file) => file.path)

  return [
    {
      id: 'scan',
      title: '5-minute scan',
      duration: '5 min',
      goal: 'Understand what the project is and where to start reading.',
      files: unique([...docsFiles, ...entryFiles]).slice(0, 6),
      outcomes: ['Know the project purpose', 'Identify entry points', 'Understand the top-level architecture map'],
    },
    {
      id: 'core',
      title: 'Core flow reading',
      duration: '30 min',
      goal: 'Trace the main execution path from entry points into core modules.',
      files: unique([...entryFiles, ...coreFiles]).slice(0, 8),
      outcomes: ['Explain the main code path', 'Name the core modules', 'Know where data or external calls happen'],
    },
    {
      id: 'operate',
      title: 'Run and validate',
      duration: '30-60 min',
      goal: 'Run the project locally and use tests or build scripts to verify understanding.',
      files: unique([...runbook.configFiles, ...testFiles]).slice(0, 8),
      outcomes: ['Know installation commands', 'Know run/test commands', 'Understand important config files'],
    },
    {
      id: 'extend',
      title: 'Deep dive and extension',
      duration: '2 hours',
      goal: 'Pick a module branch and make a small change or contribution.',
      files: modules.flatMap((module) => module.readingOrder.slice(0, 2)).slice(0, 10),
      outcomes: ['Understand extension points', 'Know module dependencies', 'Find a safe contribution path'],
    },
  ]
}

function applyLearningPathNotes(steps: LearningStep[], notes: string[]) {
  if (notes.length === 0) {
    return steps
  }

  return steps.map((step, index) => ({
    ...step,
    goal: notes[index] || step.goal,
  }))
}

function buildRepoRisks(context: RepoContext, modules: RepoModule[]) {
  const risks: string[] = []

  if (context.tree.truncated) {
    risks.push('GitHub returned a truncated tree, so the architecture may miss some files.')
  }
  if (!context.readmeExcerpt) {
    risks.push('README content is unavailable, which reduces learning context.')
  }
  if (context.sampledFiles.length < 5) {
    risks.push('Only a small number of key files could be sampled.')
  }
  if (!modules.some((module) => module.kind === 'test')) {
    risks.push('No obvious test module was detected.')
  }
  if (context.repo.archived) {
    risks.push('Repository is archived.')
  }

  return risks
}

function inferTechStack(context: RepoContext) {
  const stack = new Set<string>()
  if (context.repo.language) {
    stack.add(context.repo.language)
  }

  for (const file of context.manifestFiles) {
    if (file.path.endsWith('package.json')) {
      stack.add('Node.js')
      const dependencies = readPackageDependencies(file.content)
      for (const dependency of dependencies.slice(0, 12)) {
        if (isSignalDependency(dependency)) {
          stack.add(dependency)
        }
      }
    }
    if (file.path.endsWith('pyproject.toml') || file.path.endsWith('requirements.txt')) stack.add('Python')
    if (file.path.endsWith('go.mod')) stack.add('Go')
    if (file.path.endsWith('Cargo.toml')) stack.add('Rust')
    if (file.path.endsWith('pom.xml') || file.path.endsWith('build.gradle')) stack.add('Java')
  }

  return [...stack].slice(0, 16)
}

function inferProblem(context: RepoContext) {
  const source = `${context.repo.description ?? ''} ${context.readmeExcerpt}`.trim()
  if (!source) {
    return 'The repository does not publish enough summary text to infer the problem statement confidently.'
  }

  return compactSummary(source)
}

function inferAudience(context: RepoContext, techStack: string[]) {
  const text = `${context.repo.description ?? ''} ${(context.repo.topics ?? []).join(' ')} ${techStack.join(' ')}`.toLowerCase()
  const audience = new Set<string>()
  if (containsAny(text, ['react', 'vue', 'ui', 'frontend'])) audience.add('Frontend developers')
  if (containsAny(text, ['api', 'server', 'database', 'backend'])) audience.add('Backend developers')
  if (containsAny(text, ['ai', 'llm', 'agent', 'model'])) audience.add('AI engineers')
  if (containsAny(text, ['cli', 'sdk', 'toolkit', 'developer'])) audience.add('Tool builders')
  if (containsAny(text, ['docker', 'kubernetes', 'deploy', 'infra'])) audience.add('DevOps engineers')
  if (audience.size === 0) audience.add('Open-source learners')
  return [...audience]
}

function inferDifficulty(fileCount: number, moduleCount: number, truncated: boolean): RepoAnalysis['overview']['difficulty'] {
  if (truncated || fileCount > 1000 || moduleCount > 7) {
    return 'advanced'
  }
  if (fileCount > 120 || moduleCount > 4) {
    return 'intermediate'
  }
  return 'beginner'
}

function buildMaintenanceSignals(repo: SearchRepo, treeTruncated: boolean) {
  const signals = [
    `${repo.stargazers_count} stars`,
    `${repo.forks_count} forks`,
    `${repo.open_issues_count} open issues`,
    `Last pushed: ${repo.pushed_at ?? 'unknown'}`,
  ]

  if (repo.archived) signals.push('Archived repository')
  if (repo.disabled) signals.push('Disabled repository')
  if (treeTruncated) signals.push('Large repository tree')
  if (repo.license?.spdx_id) signals.push(`License: ${repo.license.spdx_id}`)

  return signals
}

function pickKeyFilePaths(entries: GitHubTreeEntry[], limit: number) {
  const scored = entries
    .filter((entry) => isTextLikePath(entry.path) && (entry.size ?? 0) <= 80_000)
    .map((entry) => ({ entry, score: scoreFileForSampling(entry.path) }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.entry.path)

  return unique(scored).slice(0, limit)
}

function scoreFileForSampling(path: string) {
  let score = 0
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower

  if (isManifestPath(path)) score += 120
  if (isEntrypointPath(path)) score += 100
  if (lower.includes('/src/') || lower.startsWith('src/')) score += 50
  if (lower.includes('/app/') || lower.startsWith('app/')) score += 45
  if (lower.includes('/server') || lower.includes('/api/')) score += 40
  if (lower.includes('/test') || lower.includes('.test.') || lower.includes('.spec.')) score += 25
  if (base.includes('index') || base.includes('main') || base.includes('app')) score += 30
  if (lower.includes('readme')) score += 30
  if (path.split('/').length <= 2) score += 20
  return score
}

function classifyPath(path: string): ArchitectureKind {
  const lower = path.toLowerCase()
  const filename = lower.split('/').pop() ?? lower

  if (lower.includes('readme') || lower.startsWith('docs/') || lower.includes('/docs/')) return 'docs'
  if (isConfigPath(path) || isManifestPath(path)) return 'build'
  if (lower.includes('docker') || lower.startsWith('.github/') || lower.includes('/deploy') || lower.includes('/infra')) return 'infra'
  if (lower.includes('/test') || lower.includes('/tests') || lower.includes('.test.') || lower.includes('.spec.')) return 'test'
  if (lower.includes('/db/') || lower.includes('/data/') || lower.includes('/model') || lower.includes('/schema')) return 'data'
  if (lower.includes('/api/') || lower.includes('/routes/') || lower.includes('/pages/') || lower.includes('/components/')) return 'interface'
  if (lower.includes('/client') || lower.includes('/sdk') || lower.includes('/integrations/') || lower.includes('/providers/')) return 'integration'
  if (isEntrypointPath(path) || ['main.ts', 'main.tsx', 'main.js', 'index.ts', 'index.tsx', 'index.js', 'app.tsx'].includes(filename)) return 'entry'
  return 'core'
}

function architectureLabel(kind: ArchitectureKind) {
  const labels: Record<ArchitectureKind, string> = {
    overview: 'Repository Overview',
    entry: 'Entry Points',
    interface: 'Interface Layer',
    core: 'Core Domain',
    data: 'Data and Storage',
    integration: 'Integrations',
    infra: 'Infrastructure',
    test: 'Testing',
    docs: 'Documentation',
    build: 'Build and Tooling',
  }

  return labels[kind]
}

function architectureSummary(kind: ArchitectureKind) {
  const summaries: Record<ArchitectureKind, string> = {
    overview: 'Global view of the repository learning map.',
    entry: 'Files that start the app, CLI, worker, server, or package exports.',
    interface: 'User-facing routes, API handlers, components, or adapters.',
    core: 'Main business logic, algorithms, services, or domain workflows.',
    data: 'Models, schemas, persistence, cache, and data access logic.',
    integration: 'External SDKs, clients, providers, and third-party service boundaries.',
    infra: 'Deployment, CI, container, cloud, and operations configuration.',
    test: 'Tests, fixtures, validation harnesses, and quality checks.',
    docs: 'Learning materials, examples, README content, and project documentation.',
    build: 'Package manifests, bundlers, scripts, type configs, and build tooling.',
  }

  return summaries[kind]
}

function inferGroupConfidence(kind: ArchitectureKind, entries: GitHubTreeEntry[]) {
  if (kind === 'core') return 0.55
  if (entries.length > 20) return 0.8
  return 0.7
}

function pickRepresentativePaths(entries: GitHubTreeEntry[], limit: number) {
  return entries
    .slice()
    .sort((left, right) => scoreFileForSampling(right.path) - scoreFileForSampling(left.path))
    .map((entry) => entry.path)
    .slice(0, limit)
}

function pickDirectories(entries: GitHubTreeEntry[], limit: number) {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const directory = topDirectory(entry.path)
    counts.set(directory, (counts.get(directory) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([directory]) => directory)
    .slice(0, limit)
}

function pickReadingOrder(kind: ArchitectureKind, entries: GitHubTreeEntry[]) {
  const representatives = pickRepresentativePaths(entries, 10)
  if (kind === 'docs') {
    return representatives.sort((left, right) => Number(right.toLowerCase().includes('readme')) - Number(left.toLowerCase().includes('readme')))
  }
  return representatives
}

function buildModuleRisks(kind: ArchitectureKind, entries: GitHubTreeEntry[]) {
  const risks: string[] = []
  if (kind === 'core' && entries.length > 250) {
    risks.push('Core domain is large; read it by branches instead of file-by-file.')
  }
  if (kind === 'test' && entries.length < 3) {
    risks.push('Testing surface appears small.')
  }
  if (kind === 'docs' && entries.length < 2) {
    risks.push('Documentation surface appears thin.')
  }
  return risks
}

function inferFileRole(path: string) {
  const lower = path.toLowerCase()
  if (lower.includes('package.json')) return 'Package manifest and scripts'
  if (lower.includes('readme')) return 'Primary documentation'
  if (isEntrypointPath(path)) return 'Application or package entry point'
  if (lower.includes('test') || lower.includes('spec')) return 'Validation or example behavior'
  if (isConfigPath(path)) return 'Configuration'
  return architectureSummary(classifyPath(path))
}

function isEntrypointPath(path: string) {
  const lower = path.toLowerCase()
  const filename = lower.split('/').pop() ?? lower
  return (
    ['main.ts', 'main.tsx', 'main.js', 'main.py', 'index.ts', 'index.tsx', 'index.js', 'app.ts', 'app.tsx'].includes(filename) ||
    lower.endsWith('/src/main.rs') ||
    lower.endsWith('/cmd/main.go') ||
    lower.endsWith('/worker/src/index.ts')
  )
}

function isManifestPath(path: string) {
  const filename = path.toLowerCase().split('/').pop() ?? path.toLowerCase()
  return [
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'gemfile',
    'deno.json',
  ].includes(filename)
}

function isConfigPath(path: string) {
  const lower = path.toLowerCase()
  const filename = lower.split('/').pop() ?? lower
  return (
    filename.startsWith('tsconfig') ||
    filename.startsWith('vite.config') ||
    filename.startsWith('eslint.config') ||
    filename.startsWith('webpack.config') ||
    filename.startsWith('rollup.config') ||
    filename === 'dockerfile' ||
    filename === 'wrangler.toml' ||
    filename === '.env.example' ||
    lower.startsWith('.github/')
  )
}

function isTextLikePath(path: string) {
  const lower = path.toLowerCase()
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2']
  return !binaryExtensions.some((extension) => lower.endsWith(extension))
}

function readPackageScripts(content: string) {
  try {
    const parsed = JSON.parse(content)
    if (!isRecord(parsed.scripts)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function readPackageDependencies(content: string) {
  try {
    const parsed = JSON.parse(content)
    const dependencies = isRecord(parsed.dependencies) ? Object.keys(parsed.dependencies) : []
    const devDependencies = isRecord(parsed.devDependencies) ? Object.keys(parsed.devDependencies) : []
    return unique([...dependencies, ...devDependencies])
  } catch {
    return []
  }
}

function isSignalDependency(name: string) {
  return [
    'react',
    'vue',
    'svelte',
    'next',
    'vite',
    'express',
    'fastify',
    'hono',
    'typescript',
    'tailwindcss',
    'openai',
    'langchain',
    'drizzle-orm',
    'prisma',
    'zod',
  ].includes(name)
}

function mergeCandidate(
  candidates: Map<string, SearchRepo & { sources: string[]; trendRank?: number }>,
  repo: SearchRepo,
  source: string,
) {
  const existing = candidates.get(repo.full_name)
  if (!existing) {
    candidates.set(repo.full_name, {
      ...repo,
      sources: [source],
    })
    return
  }

  if (!existing.sources.includes(source)) {
    existing.sources.push(source)
  }
}

function scoreRepo(repo: SearchRepo & { sources: string[]; trendRank?: number }) {
  const trendingBonus = repo.trendRank ? Math.max(0, 400 - repo.trendRank * 12) : 0
  const sourceBonus = repo.sources.length * 25
  const freshnessBonus = daysSince(repo.created_at) <= 2 ? 80 : 0
  return repo.stargazers_count + repo.forks_count * 3 + trendingBonus + sourceBonus + freshnessBonus
}

function daysSince(dateValue: string) {
  const then = new Date(dateValue).getTime()
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24))
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
  return summary.length > 320 ? `${summary.slice(0, 317).trim()}...` : summary
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function getDateKey(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function toInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseRepoInput(input: unknown) {
  if (!isRecord(input)) {
    return null
  }

  const force = input.force === true
  const owner = asString(input.owner).trim()
  const repo = asString(input.repo).trim()
  if (owner && repo) {
    return { owner, repo, force }
  }

  const url = asString(input.url).trim()
  const parsed = parseGithubRepoUrl(url)
  return parsed ? { ...parsed, force } : null
}

function parseGithubRepoUrl(value: string) {
  if (!value) {
    return null
  }

  const shorthand = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/, '') }
  }

  try {
    const url = new URL(value)
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      return null
    }
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo) {
      return null
    }
    return { owner, repo: repo.replace(/\.git$/, '') }
  } catch {
    return null
  }
}

function parseRepoRoute(pathname: string) {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments[0] !== 'api' || segments[1] !== 'repos' || segments.length < 5) {
    return null
  }

  const owner = segments[2]
  const repo = segments[3]
  const section = segments[4]

  if (section === 'modules' && segments[5]) {
    return { owner, repo, section: 'module', moduleId: segments[5] }
  }

  if (['status', 'analysis', 'architecture'].includes(section)) {
    return { owner, repo, section }
  }

  return null
}

function normalizeRepoKey(fullName: string) {
  return fullName.toLowerCase()
}

function getRepoAnalysisKey(repoKey: string, commitSha: string) {
  return `${repoCachePrefix}:${repoKey}:${commitSha}:analysis:v${repoAnalysisVersion}`
}

function getRepoLatestKey(repoKey: string) {
  return `${repoCachePrefix}:${repoKey}:latest`
}

function getRepoStatusKey(repoKey: string) {
  return `${repoCachePrefix}:${repoKey}:status`
}

function getRepoLockKey(repoKey: string, commitSha: string) {
  return `${repoCachePrefix}:${repoKey}:${commitSha}:lock`
}

function repoAnalysisTtl(env: Env) {
  return toInt(env.REPO_ANALYSIS_CACHE_TTL_SECONDS, 60 * 60 * 24 * 30)
}

function encodeRepoFullName(fullName: string) {
  return fullName.split('/').map(encodeURIComponent).join('/')
}

function topDirectory(path: string) {
  const parts = path.split('/')
  if (parts.length === 1) {
    return '/'
  }
  return parts[0]
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'root'
}

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word))
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

async function readJson<T>(env: Env, key: string) {
  const value = await env.DAILY_REPORT_CACHE.get(key)
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function jsonResponse<T>(body: T, request: Request, env: Env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  })
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin')
  const allowedOrigin = env.ALLOWED_ORIGIN || '*'
  const responseOrigin = allowedOrigin === '*' || !origin ? allowedOrigin : origin === allowedOrigin ? origin : allowedOrigin

  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string').slice(0, 8)
}
