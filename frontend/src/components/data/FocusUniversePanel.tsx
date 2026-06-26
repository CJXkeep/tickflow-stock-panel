import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, SlidersHorizontal } from 'lucide-react'
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

  const visibleSymbols = preview?.symbols.slice(0, 160) ?? []
  const hiddenCount = Math.max(0, (preview?.symbols.length ?? 0) - visibleSymbols.length)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-card border border-border bg-base/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">当前预览</span>
        </div>
        <span className="font-mono text-sm text-accent">{loading ? '—' : `${preview?.count ?? 0} 只`}</span>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs text-muted">手动追加</span>
          <textarea
            value={includeText}
            onChange={(e) => setIncludeText(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-muted">手动排除</span>
          <textarea
            value={excludeText}
            onChange={(e) => setExcludeText(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-btn border border-border bg-base px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
          />
        </label>
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
          <span className="text-xs text-muted">维表兜底上限</span>
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
          <span className="text-muted">标的预览</span>
          {preview?.fallback_used && (
            <span className="text-accent">{preview.source_labels[preview.fallback_used] ?? preview.fallback_used}</span>
          )}
        </div>
        <div className="max-h-40 overflow-auto rounded-btn bg-surface/60 p-2 font-mono text-[11px] text-secondary">
          {loading ? (
            <span className="text-muted">加载中...</span>
          ) : visibleSymbols.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {visibleSymbols.map(symbol => <span key={symbol}>{symbol}</span>)}
              {hiddenCount > 0 && <span className="text-muted">+{hiddenCount}</span>}
            </div>
          ) : (
            <span className="text-muted">空</span>
          )}
        </div>
      </div>

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
