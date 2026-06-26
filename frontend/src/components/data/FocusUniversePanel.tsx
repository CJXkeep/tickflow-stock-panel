import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Save, Search, SlidersHorizontal } from 'lucide-react'
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

function parseSymbols(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,，;；]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean),
  ))
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

function StockList({
  empty,
  children,
  maxHeight = 'max-h-44',
}: {
  empty: string
  children: React.ReactNode
  maxHeight?: string
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className={`${maxHeight} overflow-auto rounded-btn border border-border bg-surface/60`}>
      {hasChildren ? children : (
        <div className="px-3 py-3 text-xs text-muted">{empty}</div>
      )}
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
  const [query, setQuery] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!preview) return
    setSources(preview.config.sources)
    setIncludeText(formatSymbols(preview.config.include_symbols))
    setExcludeText(formatSymbols(preview.config.exclude_symbols))
    setAlertLimit(String(preview.config.alert_limit))
    setFallbackLimit(String(preview.config.local_fallback_limit))
  }, [preview])

  const payload = useMemo<Partial<FocusUniverseConfig>>(() => ({
    sources,
    include_symbols: parseSymbols(includeText),
    exclude_symbols: parseSymbols(excludeText),
    alert_limit: Number(alertLimit) || 0,
    local_fallback_limit: Number(fallbackLimit) || 0,
  }), [sources, includeText, excludeText, alertLimit, fallbackLimit])

  const update = useMutation({
    mutationFn: () => api.updateFocusUniverse(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.focusUniverse })
      qc.invalidateQueries({ queryKey: QK.preferences })
      onClose()
    },
  })

  const includeSymbols = useMemo(() => parseSymbols(includeText), [includeText])
  const excludeSymbols = useMemo(() => parseSymbols(excludeText), [excludeText])
  const excludeSet = useMemo(() => new Set(excludeSymbols), [excludeSymbols])
  const localFinalSymbols = useMemo(() => {
    const fromSources = new Set<string>()
    Object.entries(preview?.by_source ?? {}).forEach(([source, symbols]) => {
      if (source === 'manual_include' || sources[source] === false) return
      symbols.forEach(symbol => fromSources.add(symbol))
    })
    includeSymbols.forEach(symbol => fromSources.add(symbol))
    excludeSymbols.forEach(symbol => fromSources.delete(symbol))
    return Array.from(fromSources).sort()
  }, [preview?.by_source, sources, includeSymbols, excludeSymbols])

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
  const nameOf = (symbol: string) => localNames[symbol] || preview?.names?.[symbol] || ''

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
            className="flex items-center justify-between rounded-btn border border-border bg-base/30 px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2 text-secondary">
              <input
                type="checkbox"
                checked={!!sources[key]}
                onChange={(e) => setSources(v => ({ ...v, [key]: e.target.checked }))}
                className="h-3.5 w-3.5 accent-accent"
              />
              {preview?.source_labels[key] ?? key}
            </span>
            <span className="font-mono text-muted">{preview?.by_source_counts[key] ?? 0}</span>
          </label>
        ))}
      </div>

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-card border border-border bg-base/30 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">已追加</span>
            <span className="font-mono text-muted">{includeSymbols.length}</span>
          </div>
          <StockList empty="从搜索结果或下方来源中选择" maxHeight="max-h-40">
            {includeSymbols.map(symbol => (
              <StockRow
                key={symbol}
                symbol={symbol}
                name={nameOf(symbol)}
                meta="手动追加"
                action="移除"
                actionTone="include"
                onAction={() => removeInclude(symbol)}
              />
            ))}
          </StockList>
        </div>
        <div className="rounded-card border border-border bg-base/30 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">已排除</span>
            <span className="font-mono text-muted">{excludeSymbols.length}</span>
          </div>
          <StockList empty="点击来源股票可排除" maxHeight="max-h-40">
            {excludeSymbols.map(symbol => (
              <StockRow
                key={symbol}
                symbol={symbol}
                name={nameOf(symbol)}
                meta="不同步"
                action="恢复"
                actionTone="exclude"
                onAction={() => removeExclude(symbol)}
              />
            ))}
          </StockList>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs text-muted">最近告警上限</span>
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
          <span className="text-xs text-muted">无选择时兜底数量</span>
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

      <div className="rounded-card border border-border bg-base/30 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">按来源选择</span>
          {preview?.fallback_used && (
            <span className="text-accent">{preview.source_labels[preview.fallback_used] ?? preview.fallback_used}</span>
          )}
        </div>
        <div className="max-h-72 space-y-3 overflow-auto rounded-btn bg-surface/60 p-2">
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
        className="text-xs text-muted hover:text-secondary"
      >
        {showAdvanced ? '收起批量代码编辑' : '批量代码编辑'}
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted">追加代码</span>
            <textarea
              value={includeText}
              onChange={(e) => setIncludeText(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted">排除代码</span>
            <textarea
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
            />
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="inline-flex items-center gap-1.5 rounded-btn border border-accent/30 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
        >
          {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存
        </button>
      </div>
    </div>
  )
}
