import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const CRON_SECRET = process.env.CRON_SECRET || ''
const LOGS_DIR = process.env.AGENT_LOGS_DIR || join(process.cwd(), 'data', 'agent-logs')
const MEMORY_DIR = process.env.AGENT_MEMORY_DIR || join(process.cwd(), 'data', 'agent-memory')

function auth(req: NextRequest): boolean {
  return !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
}

type LogEntry = {
  agent: string
  timestamp: string
  action: string
  result: string
  details: Record<string, unknown>
  duration_ms?: number
}

type MemoryEntry = { type: string; content: string; tags: string[]; date: string; id: number }
type Memory = { agent: string; entries: MemoryEntry[]; skills: string[]; lastUpdated: string }

async function readLogs(agent: string, days: number = 30): Promise<LogEntry[]> {
  const filePath = join(LOGS_DIR, `${agent}.jsonl`)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    return raw.trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as LogEntry } catch { return null } })
      .filter((e): e is LogEntry => !!e && e.timestamp > cutoff)
  } catch { return [] }
}

async function readMemory(agent: string): Promise<Memory> {
  const filePath = join(MEMORY_DIR, `${agent}.json`)
  try { return JSON.parse(await readFile(filePath, 'utf-8')) }
  catch { return { agent, entries: [], skills: [], lastUpdated: '' } }
}

async function writeMemory(memory: Memory) {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true })
  memory.lastUpdated = new Date().toISOString()
  await writeFile(join(MEMORY_DIR, `${memory.agent}.json`), JSON.stringify(memory, null, 2))
}

function analyzePatterns(logs: LogEntry[]): {
  successRate: number
  errorPatterns: Record<string, number>
  avgDuration: number | null
  totalRuns: number
  lastRun: string | null
  trends: string[]
} {
  if (logs.length === 0) return { successRate: 0, errorPatterns: {}, avgDuration: null, totalRuns: 0, lastRun: null, trends: [] }

  const total = logs.length
  const successes = logs.filter(l => l.result === 'ok' || l.result === 'skip').length
  const successRate = Math.round((successes / total) * 100)

  const errorPatterns: Record<string, number> = {}
  for (const log of logs) {
    if (log.result === 'error') {
      const msg = String(log.details?.error || log.details?.message || 'unknown')
        .slice(0, 100)
      errorPatterns[msg] = (errorPatterns[msg] || 0) + 1
    }
  }

  const durations = logs.filter(l => l.duration_ms).map(l => l.duration_ms!)
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null

  const trends: string[] = []
  const recent = logs.slice(-5)
  const older = logs.slice(-10, -5)
  if (recent.length >= 3 && older.length >= 3) {
    const recentSuccess = recent.filter(l => l.result === 'ok').length / recent.length
    const olderSuccess = older.filter(l => l.result === 'ok').length / older.length
    if (recentSuccess < olderSuccess - 0.2) trends.push('degradation: success rate dropping')
    if (recentSuccess > olderSuccess + 0.2) trends.push('improvement: success rate rising')
  }

  if (durations.length >= 6) {
    const recentDur = durations.slice(-3).reduce((a, b) => a + b, 0) / 3
    const olderDur = durations.slice(-6, -3).reduce((a, b) => a + b, 0) / 3
    if (recentDur > olderDur * 1.5) trends.push('slowdown: execution time increasing')
  }

  return {
    successRate,
    errorPatterns,
    avgDuration,
    totalRuns: total,
    lastRun: logs[logs.length - 1]?.timestamp || null,
    trends,
  }
}

function generateInsights(agent: string, analysis: ReturnType<typeof analyzePatterns>): MemoryEntry[] {
  const insights: MemoryEntry[] = []
  const now = new Date().toISOString()

  if (analysis.totalRuns > 0) {
    insights.push({
      type: 'metric',
      content: `Success rate: ${analysis.successRate}% over ${analysis.totalRuns} runs. Avg duration: ${analysis.avgDuration ? analysis.avgDuration + 'ms' : 'N/A'}`,
      tags: ['performance', 'auto-generated'],
      date: now,
      id: 0,
    })
  }

  for (const [pattern, count] of Object.entries(analysis.errorPatterns)) {
    if (count >= 2) {
      insights.push({
        type: 'pattern',
        content: `Recurring error (${count}x): ${pattern}`,
        tags: ['error', 'auto-generated'],
        date: now,
        id: 0,
      })
    }
  }

  for (const trend of analysis.trends) {
    insights.push({
      type: 'trend',
      content: trend,
      tags: ['trend', 'auto-generated'],
      date: now,
      id: 0,
    })
  }

  return insights
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const agent = sanitize((body as { agent?: string }).agent || '')
  const days = (body as { days?: number }).days || 30

  if (!agent) return NextResponse.json({ error: 'agent param required' }, { status: 400 })

  if (!existsSync(LOGS_DIR)) await mkdir(LOGS_DIR, { recursive: true })

  const logs = await readLogs(agent, days)
  const analysis = analyzePatterns(logs)
  const insights = generateInsights(agent, analysis)

  const memory = await readMemory(agent)

  memory.entries = memory.entries.filter(e => !e.tags.includes('auto-generated'))

  let nextId = memory.entries.length > 0 ? Math.max(...memory.entries.map(e => e.id)) + 1 : 1
  for (const insight of insights) {
    insight.id = nextId++
    memory.entries.push(insight)
  }

  await writeMemory(memory)

  return NextResponse.json({
    agent,
    analysis,
    insightsGenerated: insights.length,
    totalMemoryEntries: memory.entries.length,
  })
}
