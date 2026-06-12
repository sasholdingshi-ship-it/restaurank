import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const CRON_SECRET = process.env.CRON_SECRET || ''
const LOGS_DIR = process.env.AGENT_LOGS_DIR || join(process.cwd(), 'data', 'agent-logs')

function auth(req: NextRequest): boolean {
  return !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
}

async function ensureDir() {
  if (!existsSync(LOGS_DIR)) await mkdir(LOGS_DIR, { recursive: true })
}

type LogEntry = {
  agent: string
  timestamp: string
  action: string
  result: 'ok' | 'error' | 'skip' | 'partial'
  details: Record<string, unknown>
  duration_ms?: number
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = sanitize(req.nextUrl.searchParams.get('agent') || '')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)
  if (!agent) return NextResponse.json({ error: 'agent param required' }, { status: 400 })

  await ensureDir()
  const filePath = join(LOGS_DIR, `${agent}.jsonl`)

  try {
    const raw = await readFile(filePath, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const entries = lines.slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    return NextResponse.json({ agent, entries, total: lines.length })
  } catch {
    return NextResponse.json({ agent, entries: [], total: 0 })
  }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Partial<LogEntry>
  const agent = sanitize(body.agent || '')
  if (!agent) return NextResponse.json({ error: 'agent required' }, { status: 400 })

  await ensureDir()
  const filePath = join(LOGS_DIR, `${agent}.jsonl`)

  const entry: LogEntry = {
    agent,
    timestamp: new Date().toISOString(),
    action: body.action || 'unknown',
    result: body.result || 'ok',
    details: body.details || {},
    duration_ms: body.duration_ms,
  }

  await appendFile(filePath, JSON.stringify(entry) + '\n')
  return NextResponse.json({ ok: true })
}
