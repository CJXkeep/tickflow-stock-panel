import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Search, SlidersHorizontal } from 'lucide-react'
import { api, type FocusUniverseConfig, type FocusUniversePreview } from '@/lib/api'
import { QK } from '@/lib/queryKeys'

const SOURCE_ORDER = [
  'watchlist',
  'monitor_rules',
  'strategy_tracking',
  'recent_alerts',
  'local_fallback',
  'demo',
] as const

function normalizeImportedSymbol(raw: string) {
  const token = raw
    .trim()
    .replace(/^[`'"\u201c\u201d\u2018\u2019]+|[`'"\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/[，,;；]+$/g, '')
    .replace(/．/g, '.')
    .toUpperCase()
  if (!token || ['代码', '名称', 'SYMBOL', 'CODE', 'NAME'].includes(token)) return null
  if (!/^[A-Z0-9._-]+$/.test(token)) return null

  let match = token.match(/^(SH|SZ|BJ)[._-]?(\d{5,6})$/)
  if (match) return `${match[2].padStart(6, '0')}.${match[1]}`

  match = token.match(/^(\d{5,6})[._-]?(SH|SZ|BJ)$/)
  if (match) return `${match[1].padStart(6, '0')}.${match[2]}`

  if (/^\d{6}$/.test(token)) {
    if (/^(43|83|87|92)/.test(token)) return `${token}.BJ`
    if (/^[569]/.test(token)) return `${token}.SH`
    if (/^[0123]/.test(token)) return `${token}.SZ`
  }

  return token
}

function parseSymbols(value: string) {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string) => {
    const symbol = normalizeImportedSymbol(raw)
    if (symbol && !seen.has(symbol)) {
      seen.add(symbol)
      out.push(symbol)
    }
  }

  value.split(/\r?\n/).forEach(line => {
    const tokens = line.trim().split(/[\t\s,，;；]+/).filter(Boolean)
    if (tokens.length === 0) return
    const allTokensAreSymbols = tokens.every(token => normalizeImportedSymbol(token))
    if (allTokensAreSymbols) tokens.forEach(push)
    else push(tokens[0])
  })

  return out
}

function hasKnownSymbol(names: Record<string, string>, symbol: string) {
  return Object.prototype.hasOwnProperty.call(names, symbol)
}

function formatSymbols(symbols: string[]) {
  return symbols.join('\n')
}

function toggleListText(value: string, symbol: string, enabled: boolean) {
  const symbols = parseSymbols(value)
  const next = enabled
    ? Array.from(new Set([...symbols, symbol]))
    : symbols.filter(s => s !== symbol)
  return formatSymbols(next)
}

function StockRow({
  symbol,
  name,
  meta,
  action,
  actionTone = 'neutral',
  onAction,
}: {
  symbol: string
  name?: string
  meta?: string
  action: string
  actionTone?: 'neutral' | 'include' | 'exclude'
  onAction: () => void
}) {
  const actionCls = actionTone === 'include'
    ? 'text-accent hover:bg-accent/10'
    : actionTone === 'exclude'
      ? 'text-danger hover:bg-danger/10'
      : 'text-secondary hover:bg-elevated hover:text-foreground'
  return (
    <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/50 px-2 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">{name || symbol}</div>
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <span className="font-mono">{symbol}</span>
          {meta && <span className="truncate">{meta}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={onAction}
        className={`h-7 rounded-btn px-2 text-xs transition-colors ${actionCls}`}
      >
        {action}
      </button>
    </div>
  )
}

export function FocusUniversePanel({
  preview,
  loading,
  onClose,
}: {
  preview?: FocusUniversePreview
  loading?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [sources, setSources] = useState<Record<string, boolean>>({})
  const [includeText, setIncludeText] = useState('')
  const [excludeText, setExcludeText] = useState('')
  const [alertLimit, setAlertLimit] = useState('200')
  const [fallbackLimit, setFallbackLimit] = useState('30')
  const [watchlistGroupMode, setWatchlistGroupMode] = useState<'all' | 'selected'>('all')
  const [watchlistGroupIds, setWatchlistGroupIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showSourceDetails, setShowSourceDetails] = useState(false)
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!preview) return
    setSources(preview.config.sources)
    setIncludeText(formatSymbols(preview.config.include_symbols))
    setExcludeText(formatSymbols(preview.config.exclude_symbols))
    setAlertLimit(String(preview.config.alert_limit))
    setFallbackLimit(String(preview.config.local_fallback_limit))
    setWatchlistGroupMode(preview.config.watchlist_group_mode ?? 'all')
    setWatchlistGroupIds(preview.config.watchlist_group_ids ?? [])
  }, [preview])

  const includeSymbols = useMemo(() => parseSymbols(includeText), [includeText])
  const excludeSymbols = useMemo(() => parseSymbols(excludeText), [excludeText])
  const manualSymbols = useMemo(
    () => Array.from(new Set([...includeSymbols, ...excludeSymbols])),
    [includeSymbols, excludeSymbols],
  )
  const manualNames = useQuery({
    queryKey: ['focus-universe-manual-names', manualSymbols.join('|')],
    queryFn: () => api.instrumentNames(manualSymbols),
    enabled: manualSymbols.length > 0,
    staleTime: 30_000,
  })
  const localNameMap = useMemo(
    () => ({ ...(preview?.names ?? {}), ...(manualNames.data?.names ?? {}), ...localNames }),
    [localNames, manualNames.data?.names, preview?.names],
  )
  const namesReady = manualSymbols.length === 0
    || !!manualNames.data
    || manualSymbols.every(symbol => hasKnownSymbol(localNameMap, symbol))
  const validationFailed = manualSymbols.length > 0 && manualNames.isError
  const validIncludeSymbols = useMemo(
    () => namesReady ? includeSymbols.filter(symbol => hasKnownSymbol(localNameMap, symbol)) : [],
    [includeSymbols, localNameMap, namesReady],
  )
  const validExcludeSymbols = useMemo(
    () => namesReady ? excludeSymbols.filter(symbol => hasKnownSymbol(localNameMap, symbol)) : [],
    [excludeSymbols, localNameMap, namesReady],
  )
  const invalidSymbols = useMemo(
    () => namesReady
      ? Array.from(new Set([
        ...includeSymbols.filter(symbol => !hasKnownSymbol(localNameMap, symbol)),
        ...excludeSymbols.filter(symbol => !hasKnownSymbol(localNameMap, symbol)),
      ]))
      : [],
    [excludeSymbols, includeSymbols, localNameMap, namesReady],
  )
  const invalidSet = useMemo(() => new Set(invalidSymbols), [invalidSymbols])
  const parsedIncludeSet = useMemo(() => new Set(includeSymbols), [includeSymbols])
  const parsedExcludeSet = useMemo(() => new Set(excludeSymbols), [excludeSymbols])
  const validExcludeSet = useMemo(() => new Set(validExcludeSymbols), [validExcludeSymbols])
  const effectiveIncludeSymbols = useMemo(
    () => validIncludeSymbols.filter(symbol => !validExcludeSet.has(symbol)),
    [validExcludeSet, validIncludeSymbols],
  )

  const excludeSet = useMemo(() => new Set(validExcludeSymbols), [validExcludeSymbols])
  const watchlistGroups = preview?.watchlist_groups
  const groupOptions = useMemo(
    () => [...(watchlistGroups?.custom ?? []), ...(watchlistGroups?.auto ?? [])],
    [watchlistGroups],
  )
  const groupOptionIdSet = useMemo(() => new Set(groupOptions.map(group => group.id)), [groupOptions])
  const selectedGroupSet = useMemo(() => new Set(watchlistGroupIds), [watchlistGroupIds])
  const selectedGroups = useMemo(
    () => groupOptions.filter(group => selectedGroupSet.has(group.id)),
    [groupOptions, selectedGroupSet],
  )
  const staleGroupIds = useMemo(
    () => watchlistGroupIds.filter(id => !groupOptionIdSet.has(id)),
    [groupOptionIdSet, watchlistGroupIds],
  )
  const validWatchlistGroupIds = useMemo(
    () => watchlistGroupIds.filter(id => groupOptionIdSet.has(id)),
    [groupOptionIdSet, watchlistGroupIds],
  )
  const localWatchlistSymbols = useMemo(() => {
    if (watchlistGroupMode === 'all') return watchlistGroups?.symbols ?? preview?.by_source?.watchlist ?? []
    const out = new Set<string>()
    groupOptions.forEach(group => {
      if (selectedGroupSet.has(group.id)) group.symbols.forEach(symbol => out.add(symbol))
    })
    return Array.from(out).sort()
  }, [groupOptions, preview?.by_source?.watchlist, selectedGroupSet, watchlistGroupMode, watchlistGroups?.symbols])
  const localWatchlistSample = useMemo(
    () => localWatchlistSymbols.slice(0, 18),
    [localWatchlistSymbols],
  )

  const payload = useMemo<Partial<FocusUniverseConfig>>(() => ({
    sources,
    include_symbols: effectiveIncludeSymbols,
    exclude_symbols: validExcludeSymbols,
    alert_limit: Number(alertLimit) || 0,
    local_fallback_limit: Number(fallbackLimit) || 0,
    watchlist_group_mode: watchlistGroupMode,
    watchlist_group_ids: watchlistGroupMode === 'selected' ? validWatchlistGroupIds : watchlistGroupIds,
  }), [sources, effectiveIncludeSymbols, validExcludeSymbols, alertLimit, fallbackLimit, watchlistGroupMode, validWatchlistGroupIds, watchlistGroupIds])

  const update = useMutation({
    mutationFn: () => api.updateFocusUniverse(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.focusUniverse })
      qc.invalidateQueries({ queryKey: QK.preferences })
      qc.invalidateQueries({ queryKey: QK.watchlist })
      qc.invalidateQueries({ queryKey: QK.watchlistGroupPreview })
      qc.invalidateQueries({ queryKey: ['watchlist-enriched'] })
      onClose()
    },
  })

  const toggleGroup = (groupId: string) => {
    setWatchlistGroupIds(ids => ids.includes(groupId)
      ? ids.filter(id => id !== groupId)
      : [...ids, groupId])
  }
  const localFinalSymbols = useMemo(() => {
    const fromSources = new Set<string>()
    Object.entries(preview?.by_source ?? {}).forEach(([source, symbols]) => {
      if (source === 'manual_include' || sources[source] === false) return
      const sourceSymbols = source === 'watchlist' ? localWatchlistSymbols : symbols
      sourceSymbols.forEach(symbol => fromSources.add(symbol))
    })
    effectiveIncludeSymbols.forEach(symbol => fromSources.add(symbol))
    validExcludeSymbols.forEach(symbol => fromSources.delete(symbol))
    return Array.from(fromSources).sort()
  }, [preview?.by_source, sources, localWatchlistSymbols, effectiveIncludeSymbols, validExcludeSymbols])

  const search = useQuery({
    queryKey: QK.instrumentSearch(query),
    queryFn: () => api.instrumentSearch(query, 12),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  })

  const addInclude = (symbol: string, name?: string) => {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return
    if (name) setLocalNames(v => ({ ...v, [normalized]: name }))
    setIncludeText(v => toggleListText(v, normalized, true))
    setExcludeText(v => toggleListText(v, normalized, false))
    setQuery('')
  }

  const addExclude = (symbol: string) => {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return
    setExcludeText(v => toggleListText(v, normalized, true))
    setIncludeText(v => toggleListText(v, normalized, false))
  }

  const removeInclude = (symbol: string) => setIncludeText(v => toggleListText(v, symbol, false))
  const removeExclude = (symbol: string) => setExcludeText(v => toggleListText(v, symbol, false))
  const nameOf = (symbol: string) => localNames[symbol] || localNameMap[symbol] || ''
  const importRows = useMemo(() => manualSymbols.map(symbol => {
    const side = parsedExcludeSet.has(symbol) ? 'exclude' : 'include'
    return {
      symbol,
      side,
      valid: namesReady && !invalidSet.has(symbol),
      conflict: parsedIncludeSet.has(symbol) && parsedExcludeSet.has(symbol),
    }
  }), [invalidSet, manualSymbols, namesReady, parsedExcludeSet, parsedIncludeSet])

  const visibleSymbols = localFinalSymbols.slice(0, 160)
  const hiddenCount = Math.max(0, localFinalSymbols.length - visibleSymbols.length)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-card border border-border bg-base/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">当前预览</span>
        </div>
        <span className="font-mono text-sm text-accent">{loading ? '—' : `${localFinalSymbols.length} 只`}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SOURCE_ORDER.map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-2 rounded-btn border border-border bg-base/30 px-3 py-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2 text-secondary">
              <input
                type="checkbox"
                checked={!!sources[key]}
                onChange={(e) => setSources(v => ({ ...v, [key]: e.target.checked }))}
                className="h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span className="truncate">{preview?.source_labels[key] ?? key}</span>
            </span>
            <span className="shrink-0 font-mono text-muted">{preview?.by_source_counts[key] ?? 0}</span>
          </label>
        ))}
      </div>

      {sources.watchlist && (
        <div className="rounded-card border border-border bg-base/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">观察池范围</span>
            <span className="font-mono text-muted">{localWatchlistSymbols.length} 只</span>
          </div>
          <div className="mb-3 inline-flex overflow-hidden rounded-btn border border-border bg-surface text-xs">
            <button
              type="button"
              onClick={() => setWatchlistGroupMode('all')}
              className={`px-3 py-1.5 transition-colors ${watchlistGroupMode === 'all' ? 'bg-accent/15 text-accent' : 'text-secondary hover:bg-elevated'}`}
            >
              全部观察池
            </button>
            <button
              type="button"
              onClick={() => setWatchlistGroupMode('selected')}
              className={`border-l border-border px-3 py-1.5 transition-colors ${watchlistGroupMode === 'selected' ? 'bg-accent/15 text-accent' : 'text-secondary hover:bg-elevated'}`}
            >
              指定分组
            </button>
          </div>
          {watchlistGroupMode === 'selected' && (
            <div className="space-y-2">
              <div className="max-h-44 overflow-auto rounded-btn border border-border bg-surface/60">
                {groupOptions.length > 0 ? groupOptions.map(group => (
                  <label
                    key={group.id}
                    className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedGroupSet.has(group.id)}
                        onChange={() => toggleGroup(group.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-accent"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-foreground">{group.name}</span>
                        <span className="text-[10px] text-muted">{group.kind === 'auto' ? '自动分组' : '自定义分组'}</span>
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-muted">{group.count}</span>
                  </label>
                )) : (
                  <div className="px-3 py-3 text-xs text-muted">暂无观察池分组</div>
                )}
              </div>

              {staleGroupIds.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-btn border border-warning/30 bg-warning/8 px-3 py-2 text-[11px] text-warning/90">
                  <span className="min-w-0 truncate">已忽略 {staleGroupIds.length} 个不存在的分组</span>
                  <button
                    type="button"
                    onClick={() => setWatchlistGroupIds(validWatchlistGroupIds)}
                    className="shrink-0 rounded-btn px-2 py-1 hover:bg-warning/15"
                  >
                    清理
                  </button>
                </div>
              )}

              <div className="rounded-btn border border-border bg-surface/60 px-3 py-2 text-[11px]">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-secondary">
                    已选 {selectedGroups.length} 组
                  </span>
                  <span className="font-mono text-accent">{localWatchlistSymbols.length} 只</span>
                </div>
                {selectedGroups.length > 0 ? (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {selectedGroups.slice(0, 6).map(group => (
                      <span key={group.id} className="max-w-[160px] truncate rounded border border-border bg-base px-1.5 py-0.5 text-muted">
                        {group.name}
                      </span>
                    ))}
                    {selectedGroups.length > 6 && (
                      <span className="rounded border border-border bg-base px-1.5 py-0.5 text-muted">
                        +{selectedGroups.length - 6}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-muted">未选择分组时，观察池来源不会贡献标的</div>
                )}
                {localWatchlistSample.length > 0 && (
                  <div className="line-clamp-2 font-mono text-[10px] leading-5 text-muted">
                    {localWatchlistSample.join('  ')}
                    {localWatchlistSymbols.length > localWatchlistSample.length ? '  ...' : ''}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-card border border-border bg-base/30 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">搜索添加</span>
          <span className="text-muted">来自本地维表</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入股票代码或名称"
            className="h-8 w-full rounded-btn border border-border bg-surface pl-8 pr-3 text-xs text-foreground outline-none focus:border-accent"
          />
        </div>
        {query.trim() && (
          <div className="mt-2 max-h-32 overflow-auto rounded-btn border border-border bg-surface/80">
            {(search.data?.results ?? []).length > 0 ? (
              search.data!.results.map((row) => (
                <button
                  key={row.symbol}
                  type="button"
                  onClick={() => addInclude(row.symbol, row.name)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-elevated"
                >
                  <span className="min-w-0">
                    <span className="text-foreground">{row.name || row.symbol}</span>
                    <span className="ml-2 font-mono text-secondary">{row.symbol}</span>
                  </span>
                  <Plus className="h-3.5 w-3.5 text-accent" />
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted">{search.isFetching ? '搜索中...' : '无匹配'}</div>
            )}
          </div>
        )}
      </div>

      {manualSymbols.length > 0 && (
        <div className="rounded-card border border-border bg-base/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">导入结果</span>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-accent">
                有效 {effectiveIncludeSymbols.length + validExcludeSymbols.length}/{manualSymbols.length}
              </span>
              {invalidSymbols.length > 0 && (
                <span className="font-mono text-warning/90">忽略 {invalidSymbols.length}</span>
              )}
            </div>
          </div>

          {manualNames.isFetching && (
            <div className="mb-2 rounded-btn border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted">
              正在校验本地维表…
            </div>
          )}
          {validationFailed && (
            <div className="mb-2 rounded-btn border border-warning/30 bg-warning/8 px-3 py-2 text-[11px] text-warning/90">
              维表校验失败，暂不能保存批量导入结果。
            </div>
          )}

          <div className="max-h-56 overflow-auto rounded-btn border border-border bg-surface/60">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 bg-surface text-[10px] uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="w-28 px-2 py-1.5 font-medium">代码</th>
                  <th className="px-2 py-1.5 font-medium">名称</th>
                  <th className="w-14 px-2 py-1.5 font-medium">动作</th>
                  <th className="w-20 px-2 py-1.5 font-medium">状态</th>
                  <th className="w-14 px-2 py-1.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {importRows.map(row => (
                  <tr key={row.symbol} className="border-b border-border/50 last:border-b-0">
                    <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{row.symbol}</td>
                    <td className="truncate px-2 py-1.5 text-secondary">
                      {row.valid ? (nameOf(row.symbol) || '-') : '-'}
                    </td>
                    <td className={`px-2 py-1.5 ${row.side === 'include' ? 'text-accent' : 'text-danger'}`}>
                      {row.side === 'include' ? '追加' : '排除'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        manualNames.isFetching
                          ? 'bg-elevated text-muted'
                          : row.valid
                            ? 'bg-accent/10 text-accent'
                            : 'bg-warning/10 text-warning/90'
                      }`}>
                        {manualNames.isFetching ? '校验中' : row.valid ? (row.conflict ? '排除优先' : '匹配') : '忽略'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => row.side === 'include' ? removeInclude(row.symbol) : removeExclude(row.symbol)}
                        className="text-[11px] text-secondary hover:text-foreground"
                      >
                        {row.side === 'include' ? '移除' : '恢复'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border bg-base/30 p-3">
        <button
          type="button"
          onClick={() => setShowSourceDetails(v => !v)}
          className="flex w-full items-center justify-between text-xs"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {showSourceDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            来源明细
          </span>
          {preview?.fallback_used && (
            <span className="text-accent">{preview.source_labels[preview.fallback_used] ?? preview.fallback_used}</span>
          )}
        </button>
        {showSourceDetails && (
          <div className="mt-2 max-h-72 space-y-3 overflow-auto rounded-btn bg-surface/60 p-2">
            {SOURCE_ORDER.map((key) => {
              const symbols = preview?.by_source[key] ?? []
              if (symbols.length === 0) return null
              const shown = symbols.slice(0, 80)
              const extra = symbols.length - shown.length
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted">{preview?.source_labels[key] ?? key}</span>
                    <span className="font-mono text-muted">{symbols.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-btn border border-border bg-base/40">
                    {shown.map(symbol => excludeSet.has(symbol) ? (
                      <StockRow
                        key={symbol}
                        symbol={symbol}
                        name={nameOf(symbol)}
                        meta="已排除"
                        action="恢复"
                        actionTone="exclude"
                        onAction={() => removeExclude(symbol)}
                      />
                    ) : (
                      <StockRow
                        key={symbol}
                        symbol={symbol}
                        name={nameOf(symbol)}
                        meta={preview?.source_labels[key] ?? key}
                        action="排除"
                        actionTone="neutral"
                        onAction={() => addExclude(symbol)}
                      />
                    ))}
                    {extra > 0 && <div className="px-2 py-1.5 font-mono text-[11px] text-muted">+{extra}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-base/30 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">最终同步预览</span>
          <span className="font-mono text-accent">{localFinalSymbols.length}</span>
        </div>
        <div className="max-h-56 overflow-auto rounded-btn border border-border bg-surface/60">
          {loading ? (
            <div className="px-3 py-3 text-xs text-muted">加载中...</div>
          ) : visibleSymbols.length > 0 ? (
            <>
              {visibleSymbols.map(symbol => (
                <StockRow
                  key={symbol}
                  symbol={symbol}
                  name={nameOf(symbol)}
                  meta="将同步"
                  action="排除"
                  actionTone="neutral"
                  onAction={() => addExclude(symbol)}
                />
              ))}
              {hiddenCount > 0 && <div className="px-2 py-1.5 font-mono text-[11px] text-muted">+{hiddenCount}</div>}
            </>
          ) : (
            <div className="px-3 py-3 text-xs text-muted">空</div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-secondary"
      >
        {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        高级设置
      </button>
      {showAdvanced && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-muted">告警上限</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={alertLimit}
                onChange={(e) => setAlertLimit(e.target.value)}
                className="w-full rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-muted">兜底数量</span>
              <input
                type="number"
                min={0}
                max={500}
                value={fallbackLimit}
                onChange={(e) => setFallbackLimit(e.target.value)}
                className="w-full rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-muted">批量导入</span>
              <textarea
                value={includeText}
                onChange={(e) => setIncludeText(e.target.value)}
                placeholder={'支持粘贴两列: 代码 名称\nSZ000408 藏格矿业\nSH600172 黄河旋风'}
                rows={4}
                className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-muted">排除代码</span>
              <textarea
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                placeholder={'支持同样格式,名称列会自动忽略'}
                rows={4}
                className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => update.mutate()}
          disabled={update.isPending || manualNames.isFetching || validationFailed}
          className="inline-flex items-center gap-1.5 rounded-btn border border-accent/30 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
        >
          {(update.isPending || manualNames.isFetching) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {manualNames.isFetching ? '校验中' : '保存'}
        </button>
      </div>
    </div>
  )
}
