import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CodexJsonRpcEvent,
  CodexModelInfo,
  CodexThread,
  CodexThreadItem,
  CodexThreadSummary,
  CodexUserInput,
  ReasoningEffort,
} from '../types/codex'
import { apiClient } from '../api/client'

type ChatEntry =
  | {
      kind: 'user'
      id: string
      text: string
    }
  | {
      kind: 'assistant'
      id: string
      text: string
      role: 'message' | 'reasoning'
      streaming?: boolean
    }
  | {
      kind: 'command'
      id: string
      command: string
      status: string
      cwd?: string
      output?: string | null
      approval?: {
        requestId: number
        decision?: 'accept' | 'decline'
        reason?: string | null
      }
    }
  | {
      kind: 'fileChange'
      id: string
      status: string
      changes: Array<{ path: string; diff?: string }>
      approval?: {
        requestId: number
        decision?: 'accept' | 'decline'
        reason?: string | null
      }
    }
  | {
      kind: 'webSearch'
      id: string
      query: string
    }
  | {
      kind: 'mcp'
      id: string
      server: string
      tool: string
      status: string
      message?: string
    }
  | {
      kind: 'system'
      id: string
      text: string
      tone?: 'info' | 'warning' | 'error'
    }

function formatEpochSeconds(value: number): string {
  return new Date(value * 1000).toLocaleString()
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isCodexTextInput(value: CodexUserInput): value is Extract<CodexUserInput, { type: 'text' }> {
  return value.type === 'text' && typeof (value as { text?: unknown }).text === 'string'
}

function extractUserText(item: Extract<CodexThreadItem, { type: 'userMessage' }>): string {
  const parts = item.content
    .filter(isCodexTextInput)
    .map((c) => c.text)
  return parts.join('\n').trim()
}

function entryFromThreadItem(item: CodexThreadItem): ChatEntry | null {
  switch (item.type) {
    case 'userMessage':
      return { kind: 'user', id: item.id, text: extractUserText(item) }
    case 'agentMessage':
      return { kind: 'assistant', id: item.id, role: 'message', text: item.text }
    case 'reasoning':
      return {
        kind: 'assistant',
        id: item.id,
        role: 'reasoning',
        text: [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join('\n'),
      }
    case 'commandExecution':
      return {
        kind: 'command',
        id: item.id,
        command: item.command,
        status: item.status,
        cwd: item.cwd,
        output: item.aggregatedOutput ?? null,
      }
    case 'fileChange':
      return {
        kind: 'fileChange',
        id: item.id,
        status: item.status,
        changes: item.changes.map((c) => ({ path: c.path, diff: c.diff })),
      }
    case 'webSearch':
      return { kind: 'webSearch', id: item.id, query: item.query }
    case 'mcpToolCall':
      return { kind: 'mcp', id: item.id, server: item.server, tool: item.tool, status: item.status }
    default:
      return null
  }
}

function mergeEntry(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
  const idx = entries.findIndex((e) => e.id === next.id && e.kind === next.kind)
  if (idx === -1) return [...entries, next]
  const copy = [...entries]
  copy[idx] = { ...copy[idx], ...next } as ChatEntry
  return copy
}

function appendDelta(entries: ChatEntry[], id: string, role: 'message' | 'reasoning', delta: string): ChatEntry[] {
  const idx = entries.findIndex((e) => e.kind === 'assistant' && e.id === id && e.role === role)
  if (idx === -1) {
    return [...entries, { kind: 'assistant', id, role, text: delta, streaming: true }]
  }
  const copy = [...entries]
  const existing = copy[idx] as Extract<ChatEntry, { kind: 'assistant' }>
  copy[idx] = { ...existing, text: `${existing.text}${delta}`, streaming: true }
  return copy
}

function formatSessionUpdatedAtMs(session: CodexThreadSummary): string {
  const updated = session.updatedAtMs ? new Date(session.updatedAtMs).toLocaleString() : '—'
  return updated
}

function normalizeThreadFromResponse(res: unknown): CodexThread | null {
  if (!res || typeof res !== 'object') return null
  const obj = res as Record<string, unknown>
  const thread = obj.thread
  if (!thread || typeof thread !== 'object') return null
  return thread as CodexThread
}

export function CodexChat() {
  const [sessions, setSessions] = useState<CodexThreadSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const [models, setModels] = useState<CodexModelInfo[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [activeThread, setActiveThread] = useState<CodexThread | null>(null)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | null>(null)

  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [configText, setConfigText] = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)

  const listSessions = useCallback(async () => {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const res = await apiClient.codexThreadList(null, 200)
      setSessions(res.data)
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to list sessions')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  const loadModels = useCallback(async () => {
    setModelsError(null)
    try {
      const res = await apiClient.codexModelList(null, 200)
      setModels(res.data)
      const defaultModel = res.data.find((m) => m.isDefault) ?? res.data[0] ?? null
      setSelectedModel(defaultModel ? defaultModel.model : null)
      setSelectedEffort(defaultModel ? defaultModel.defaultReasoningEffort : null)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Failed to load models')
    }
  }, [])

  const openConfig = useCallback(async () => {
    setIsConfigOpen(true)
    setConfigError(null)
    try {
      const content = await apiClient.codexReadConfig()
      setConfigText(content)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to read config')
    }
  }, [])

  const saveConfig = useCallback(async () => {
    setConfigSaving(true)
    setConfigError(null)
    try {
      await apiClient.codexWriteConfig(configText)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to write config')
    } finally {
      setConfigSaving(false)
    }
  }, [configText])

  const selectSession = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId)
    setEntries([])
    setActiveThread(null)
    setActiveTurnId(null)

    try {
      const res = await apiClient.codexThreadResume(threadId)
      const thread = normalizeThreadFromResponse(res)
      if (!thread) {
        setEntries([
          { kind: 'system', id: 'system-parse', tone: 'error', text: 'Failed to parse thread response.' },
        ])
        return
      }

      setActiveThread(thread)
      const historyEntries: ChatEntry[] = []
      for (const turn of thread.turns ?? []) {
        for (const item of turn.items ?? []) {
          const entry = entryFromThreadItem(item)
          if (entry) historyEntries.push(entry)
        }
      }
      setEntries(historyEntries)
    } catch (err) {
      setEntries([
        { kind: 'system', id: 'system-error', tone: 'error', text: err instanceof Error ? err.message : 'Failed to load thread' },
      ])
    }
  }, [])

  const createNewSession = useCallback(async () => {
    setEntries([])
    setActiveThread(null)
    setActiveTurnId(null)
    setSelectedThreadId(null)
    try {
      const res = await apiClient.codexThreadStart(selectedModel)
      const thread = normalizeThreadFromResponse(res)
      if (thread) {
        setSelectedThreadId(thread.id)
        setActiveThread(thread)
      }
      await listSessions()
    } catch (err) {
      setEntries([
        { kind: 'system', id: 'system-new', tone: 'error', text: err instanceof Error ? err.message : 'Failed to start thread' },
      ])
    }
  }, [listSessions, selectedModel])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text) return

    setSending(true)
    try {
      let threadId = selectedThreadId
      if (!threadId) {
        const res = await apiClient.codexThreadStart(selectedModel)
        const thread = normalizeThreadFromResponse(res)
        if (!thread) throw new Error('Failed to start thread')
        threadId = thread.id
        setSelectedThreadId(threadId)
        setActiveThread(thread)
        await listSessions()
      }

      setEntries((prev) => [...prev, { kind: 'user', id: `user-${crypto.randomUUID()}`, text }])
      setInput('')
      await apiClient.codexTurnStart(threadId, text, selectedModel, selectedEffort)
    } catch (err) {
      setEntries((prev) => [
        ...prev,
        { kind: 'system', id: `system-send-${crypto.randomUUID()}`, tone: 'error', text: err instanceof Error ? err.message : 'Failed to send' },
      ])
    } finally {
      setSending(false)
    }
  }, [input, listSessions, selectedEffort, selectedModel, selectedThreadId])

  const approve = useCallback(async (requestId: number, decision: 'accept' | 'decline') => {
    await apiClient.codexRespondApproval(requestId, decision)
  }, [])

  useEffect(() => {
    listSessions()
    loadModels()
  }, [listSessions, loadModels])

  useEffect(() => {
    let mounted = true
    const unlistenPromise = listen<CodexJsonRpcEvent>('codex_app_server', (event) => {
      if (!mounted) return
      const payload = event.payload
      if (!payload || typeof payload !== 'object') return

      if (payload.kind === 'stderr') {
        return
      }

      const message = payload.message as any
      const method = safeString(message?.method)

      if (payload.kind === 'notification') {
        const params = message?.params ?? null
        const threadId = safeString(params?.threadId ?? params?.thread_id)
        if (selectedThreadId && threadId && threadId !== selectedThreadId) return

        if (method === 'turn/started') {
          const turnId = safeString(params?.turn?.id ?? params?.turnId)
          if (turnId) setActiveTurnId(turnId)
          return
        }

        if (method === 'turn/completed') {
          const turnId = safeString(params?.turn?.id ?? params?.turnId)
          if (turnId && activeTurnId === turnId) setActiveTurnId(null)
          return
        }

        if (method === 'item/started' || method === 'item/completed') {
          const item = params?.item as CodexThreadItem | undefined
          if (!item) return
          const entry = entryFromThreadItem(item)
          if (!entry) return
          setEntries((prev) => mergeEntry(prev, entry))
          return
        }

        if (method === 'item/agentMessage/delta') {
          const itemId = safeString(params?.itemId)
          const delta = safeString(params?.delta)
          if (!itemId || !delta) return
          setEntries((prev) => appendDelta(prev, itemId, 'message', delta))
          return
        }

        if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
          const itemId = safeString(params?.itemId)
          const delta = safeString(params?.delta)
          if (!itemId || !delta) return
          setEntries((prev) => appendDelta(prev, itemId, 'reasoning', delta))
          return
        }

        if (method === 'item/mcpToolCall/progress') {
          const itemId = safeString(params?.itemId)
          const progress = safeString(params?.message)
          if (!itemId || !progress) return
          setEntries((prev) => {
            const idx = prev.findIndex((e) => e.kind === 'mcp' && e.id === itemId)
            if (idx === -1) return prev
            const copy = [...prev]
            const e = copy[idx] as Extract<ChatEntry, { kind: 'mcp' }>
            copy[idx] = { ...e, message: progress }
            return copy
          })
          return
        }

        if (method === 'error') {
          const errMsg = safeString(params?.error?.message)
          if (!errMsg) return
          setEntries((prev) => [
            ...prev,
            { kind: 'system', id: `system-err-${crypto.randomUUID()}`, tone: 'error', text: errMsg },
          ])
          return
        }
      }

      if (payload.kind === 'request') {
        const params = message?.params ?? null
        const threadId = safeString(params?.threadId)
        if (selectedThreadId && threadId && threadId !== selectedThreadId) return

        const requestId = Number(message?.id)
        if (!Number.isFinite(requestId)) return

        if (method === 'item/commandExecution/requestApproval') {
          const itemId = safeString(params?.itemId)
          const reason = params?.reason ? String(params.reason) : null
          if (!itemId) return

          setEntries((prev) =>
            prev.map((e) => {
              if (e.kind !== 'command' || e.id !== itemId) return e
              return { ...e, approval: { requestId, reason } }
            })
          )
          return
        }

        if (method === 'item/fileChange/requestApproval') {
          const itemId = safeString(params?.itemId)
          const reason = params?.reason ? String(params.reason) : null
          if (!itemId) return

          setEntries((prev) =>
            prev.map((e) => {
              if (e.kind !== 'fileChange' || e.id !== itemId) return e
              return { ...e, approval: { requestId, reason } }
            })
          )
          return
        }
      }
    })

    return () => {
      mounted = false
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {
        // ignore
      })
    }
  }, [activeTurnId, selectedThreadId])

  const selectedModelInfo = useMemo(() => {
    if (!selectedModel) return null
    return models.find((m) => m.model === selectedModel) ?? null
  }, [models, selectedModel])

  const effortOptions = useMemo(() => {
    return selectedModelInfo?.supportedReasoningEfforts ?? []
  }, [selectedModelInfo])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries.length])

  return (
    <div className="flex h-full min-h-0 gap-6">
      <aside className="w-[320px] shrink-0 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-bg-panel/70 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Codex</div>
              <div className="mt-1 text-xs text-text-muted">Sessions: {sessions.length}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                onClick={openConfig}
                title="Edit ~/.codex/config.toml"
              >
                Config
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
                onClick={() => void createNewSession()}
              >
                + New
              </button>
            </div>
          </div>
        </div>

        {sessionsError ? (
          <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
            {sessionsError}
          </div>
        ) : null}

        <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-bg-panel/70 p-2 backdrop-blur">
          {sessionsLoading ? (
            <div className="p-3 text-sm text-text-muted">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="p-3 text-sm text-text-muted">No sessions yet.</div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const isSelected = s.id === selectedThreadId
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={[
                      'w-full rounded-xl border px-3 py-2 text-left transition',
                      isSelected
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-white/10 bg-bg-panelHover hover:border-white/20',
                    ].join(' ')}
                    onClick={() => void selectSession(s.id)}
                  >
                    <div className="truncate text-sm font-semibold">{s.id}</div>
                    <div className="mt-1 truncate text-xs text-text-muted">
                      {s.preview || '—'}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-dim">
                      <span className="truncate">{s.modelProvider}</span>
                      <span className="shrink-0">{formatSessionUpdatedAtMs(s)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-bg-panel/70 backdrop-blur">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {selectedThreadId ? `Thread: ${selectedThreadId}` : 'New session'}
              </div>
              {activeThread ? (
                <div className="mt-1 text-xs text-text-muted">
                  created: {formatEpochSeconds(activeThread.createdAt)}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
              onClick={() => void listSessions()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto px-6 py-6">
          {entries.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
              {selectedThreadId ? 'No messages yet.' : 'Start a new session and say hello.'}
            </div>
          ) : null}

          {entries.map((e) => {
            if (e.kind === 'user') {
              return (
                <div key={e.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl bg-primary/15 px-4 py-3 text-sm text-text-main">
                    <div className="whitespace-pre-wrap">{e.text}</div>
                  </div>
                </div>
              )
            }

            if (e.kind === 'assistant') {
              const title = e.role === 'reasoning' ? 'Thought' : 'Assistant'
              return (
                <div key={e.id} className="flex items-start gap-3">
                  <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-white/10" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-text-dim">{title}{e.streaming ? ' (streaming)' : ''}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-text-main">{e.text}</div>
                  </div>
                </div>
              )
            }

            if (e.kind === 'command') {
              return (
                <div key={e.id} className="rounded-xl border border-white/10 bg-bg-panelHover p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-text-dim">Command</div>
                      <div className="mt-1 font-mono text-xs text-text-main">{e.command}</div>
                      {e.cwd ? <div className="mt-1 text-[11px] text-text-dim">cwd: {e.cwd}</div> : null}
                    </div>
                    <div className="shrink-0 text-xs text-text-muted">{e.status}</div>
                  </div>
                  {e.approval ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <div className="min-w-0 text-xs text-text-muted">
                        Approval required{e.approval.reason ? `: ${e.approval.reason}` : ''}.
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="rounded-md bg-status-success/20 px-3 py-1 text-xs font-semibold text-status-success"
                          onClick={() => void approve(e.approval!.requestId, 'accept')}
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-status-error/15 px-3 py-1 text-xs font-semibold text-status-error"
                          onClick={() => void approve(e.approval!.requestId, 'decline')}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {e.output ? (
                    <pre className="mt-3 max-h-[220px] overflow-auto rounded-lg bg-black/20 p-3 text-[11px] text-text-muted">
                      {e.output}
                    </pre>
                  ) : null}
                </div>
              )
            }

            if (e.kind === 'fileChange') {
              return (
                <div key={e.id} className="rounded-xl border border-white/10 bg-bg-panelHover p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-text-dim">File change</div>
                    <div className="text-xs text-text-muted">{e.status}</div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {e.changes.map((c, idx) => (
                      <div key={`${e.id}-${idx}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="truncate text-xs font-semibold">{c.path}</div>
                        {c.diff ? (
                          <pre className="mt-2 max-h-[180px] overflow-auto text-[11px] text-text-muted">
                            {c.diff}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {e.approval ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <div className="min-w-0 text-xs text-text-muted">
                        Approval required{e.approval.reason ? `: ${e.approval.reason}` : ''}.
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="rounded-md bg-status-success/20 px-3 py-1 text-xs font-semibold text-status-success"
                          onClick={() => void approve(e.approval!.requestId, 'accept')}
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-status-error/15 px-3 py-1 text-xs font-semibold text-status-error"
                          onClick={() => void approve(e.approval!.requestId, 'decline')}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            }

            if (e.kind === 'webSearch') {
              return (
                <div key={e.id} className="rounded-xl border border-white/10 bg-bg-panelHover p-4">
                  <div className="text-xs text-text-dim">Web search</div>
                  <div className="mt-2 text-sm text-text-main">{e.query}</div>
                </div>
              )
            }

            if (e.kind === 'mcp') {
              return (
                <div key={e.id} className="rounded-xl border border-white/10 bg-bg-panelHover p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-text-dim">MCP tool call</div>
                    <div className="text-xs text-text-muted">{e.status}</div>
                  </div>
                  <div className="mt-2 text-sm text-text-main">
                    <span className="font-mono text-xs">{e.server}.{e.tool}</span>
                  </div>
                  {e.message ? <div className="mt-2 text-xs text-text-muted">{e.message}</div> : null}
                </div>
              )
            }

            if (e.kind === 'system') {
              const tone = e.tone ?? 'info'
              const color =
                tone === 'error'
                  ? 'border-status-error/30 bg-status-error/10 text-status-error'
                  : tone === 'warning'
                    ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                    : 'border-white/10 bg-bg-panelHover text-text-muted'

              return (
                <div key={e.id} className={`rounded-xl border p-4 text-sm ${color}`}>
                  {e.text}
                </div>
              )
            }

            return null
          })}
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Model</span>
                <select
                  className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-xs"
                  value={selectedModel ?? ''}
                  onChange={(e) => setSelectedModel(e.target.value || null)}
                  disabled={models.length === 0}
                >
                  {models.length === 0 ? <option value="">(unavailable)</option> : null}
                  {models.map((m) => (
                    <option key={m.id} value={m.model}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Reasoning</span>
                <select
                  className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-1 text-xs"
                  value={selectedEffort ?? ''}
                  onChange={(e) => setSelectedEffort((e.target.value as ReasoningEffort) || null)}
                  disabled={effortOptions.length === 0}
                >
                  {effortOptions.length === 0 ? <option value="">(default)</option> : null}
                  {effortOptions.map((opt) => (
                    <option key={opt.reasoningEffort} value={opt.reasoningEffort}>
                      {opt.description}
                    </option>
                  ))}
                </select>
              </div>

              {modelsError ? <div className="text-xs text-status-warning">{modelsError}</div> : null}
            </div>

            <div className="flex items-end gap-3">
              <textarea
                className="min-h-[56px] w-full resize-none rounded-xl border border-white/10 bg-bg-panelHover px-4 py-3 text-sm outline-none focus:border-border-active"
                placeholder="How can I help you today?"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void sendMessage()
                  }
                }}
                disabled={sending}
              />
              <button
                type="button"
                className="h-[56px] rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                onClick={() => void sendMessage()}
                disabled={sending || input.trim().length === 0}
                title="Send (Ctrl/Cmd+Enter)"
              >
                Send
              </button>
            </div>

            {activeTurnId ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
                <div className="truncate text-xs text-text-muted">turn: {activeTurnId}</div>
                {selectedThreadId ? (
                  <button
                    type="button"
                    className="rounded-md border border-white/10 bg-black/20 px-3 py-1 text-xs hover:border-white/20"
                    onClick={() => void apiClient.codexTurnInterrupt(selectedThreadId, activeTurnId)}
                  >
                    Interrupt
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {isConfigOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/60"
            onClick={() => setIsConfigOpen(false)}
            role="button"
            tabIndex={0}
          />
          <div className="w-[520px] max-w-[90vw] border-l border-white/10 bg-bg-panel/95 p-6 backdrop-blur">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">~/.codex/config.toml</div>
                <div className="mt-1 text-xs text-text-muted">
                  Edit Codex configuration directly. Changes apply to future turns.
                </div>
              </div>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-xs hover:border-white/20"
                onClick={() => setIsConfigOpen(false)}
              >
                Close
              </button>
            </div>

            {configError ? (
              <div className="mb-3 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
                {configError}
              </div>
            ) : null}

            <textarea
              className="h-[60vh] w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-[12px] text-text-main outline-none focus:border-border-active"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              spellCheck={false}
            />

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-bg-panelHover px-4 py-2 text-sm hover:border-white/20"
                onClick={() => setIsConfigOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                onClick={() => void saveConfig()}
                disabled={configSaving}
              >
                {configSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default CodexChat
