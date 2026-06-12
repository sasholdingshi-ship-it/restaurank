import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const CRON_SECRET = process.env.CRON_SECRET || ''
const MEMORY_DIR = process.env.AGENT_MEMORY_DIR || join(process.cwd(), 'data', 'agent-memory')

function auth(req: NextRequest): boolean {
  return !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
}

async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true })
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = sanitize(req.nextUrl.searchParams.get('agent') || '')
  if (!agent) return NextResponse.json({ error: 'agent param required' }, { status: 400 })

  await ensureDir()
  const filePath = join(MEMORY_DIR, `${agent}.json`)

  try {
    const raw = await readFile(filePath, 'utf-8')
    return NextResponse.json(JSON.parse(raw))
  } catch {
    return NextResponse.json({ agent, entries: [], skills: [], lastUpdated: null })
  }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { agent: rawAgent, action, entry } = body as {
    agent?: string
    action?: 'add' | 'replace' | 'clear_old'
    entry?: { type: string; content: string; tags?: string[] }
  }

  const agent = sanitize(rawAgent || '')
  if (!agent) return NextResponse.json({ error: 'agent required' }, { status: 400 })

  await ensureDir()
  const filePath = join(MEMORY_DIR, `${agent}.json`)

  let memory: { agent: string; entries: Array<{ type: string; content: string; tags: string[]; date: string; id: number }>; skills: string[]; lastUpdated: string }
  try {
    memory = JSON.parse(await readFile(filePath, 'utf-8'))
  } catch {
    memory = { agent, entries: [], skills: [], lastUpdated: '' }
  }

  const now = new Date().toISOString()

  if (action === 'add' && entry) {
    const id = (memory.entries.length > 0 ? Math.max(...memory.entries.map(e => e.id)) : 0) + 1
    memory.entries.push({ ...entry, tags: entry.tags || [], date: now, id })
    if (memory.entries.length > 200) {
      memory.entries = memory.entries.slice(-200)
    }
  } else if (action === 'replace' && entry) {
    const idx = memory.entries.findIndex(e => e.type === entry.type && e.tags?.join(',') === (entry.tags || []).join(','))
    if (idx >= 0) memory.entries[idx] = { ...entry, tags: entry.tags || [], date: now, id: memory.entries[idx].id }
    else {
      const id = (memory.entries.length > 0 ? Math.max(...memory.entries.map(e => e.id)) : 0) + 1
      memory.entries.push({ ...entry, tags: entry.tags || [], date: now, id })
    }
  } else if (action === 'clear_old') {
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()
    memory.entries = memory.entries.filter(e => e.date > cutoff || e.type === 'rule')
  }

  memory.lastUpdated = now
  await writeFile(filePath, JSON.stringify(memory, null, 2))
  return NextResponse.json({ ok: true, totalEntries: memory.entries.length })
}
