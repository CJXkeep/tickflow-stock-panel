import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, RefreshCw, Star, X, Search, LayoutGrid, List, Settings2, Plus, Check, Filter, Eye, EyeOff, Minus, Tags } from 'lucide-react'
import { api, type KlineRow } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import { storage } from '@/lib/storage'
import { fmtPrice, fmtPct, fmtBigNum, priceColorClass } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StockPreviewDialog } from '@/components/StockPreviewDialog'
import { ColumnCustomizer } from '@/components/ColumnCustomizer'
import { StockDataTable } from '@/components/stock-table/StockDataTable'
import { useTableSort } from '@/components/stock-table/useTableSort'
import { MiniCandlestick } from '@/components/stock-table/MiniCandlestick'
import { boardTag, renderBuiltinDataCell } from '@/components/stock-table/primitives'
import { getSignals, signalCls, getSortValue, UNSORTABLE_KEYS } from '@/lib/stock-table'
import { resolveCandleConfig } from '@/lib/list-columns'
import {
  type ColumnConfig,
  BUILTIN_COLUMNS,
  COLUMN_GROUPS,
  loadColumnConfig,
  saveColumnConfig,
  buildExtColumnsParam,
} from '@/lib/watchlist-columns'

// ===== 板块标识（筛选/卡片用） =====
// 注: boardTag（创/科/北 标签）已移至共享 @/components/stock-table/primitives

const BOARDS = ['沪主板', '深主板', '创业板', '科创板', '北交所'] as const
type BoardType = typeof BOARDS[number]

function getBoardType(symbol: string): BoardType | null {
  if (/^(300|301)/.test(symbol)) return '创业板'
  if (/^688/.test(symbol))       return '科创板'
  if (/\.BJ$/.test(symbol))      return '北交所'
  if (/^60[0135]/.test(symbol))  return '沪主板'
  if (/^00[012]/.test(symbol))   return '深主板'
  return null
}

function groupSourceLabel(source?: string) {
  if (source === 'concept') return '概念'
  if (source === 'industry') return '行业'
  if (source === 'exchange') return '市场'
  if (source === 'source') return '来源'
  return '分组'
}

function customGroupSummary(groups: { name: string }[]) {
  if (groups.length > 1) return `${groups[0].name}+${groups.length - 1}`
  return groups[0]?.name
}

function customGroupTitle(symbol: string, groups: { name: string }[], hasCustomGroups: boolean) {
  if (groups.length) return `${symbol}：${groups.map(group => group.name).join('、')}`
  return hasCustomGroups ? `设置 ${symbol} 的自定义分组` : '先创建自定义分组'
}

// ===== 换手率分档色（卡片/表格用） =====

function turnoverColor(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return 'text-[#888]'
  if (rate < 5)   return 'text-[#888]'
  if (rate < 10)  return 'text-[#d4a800]'
  if (rate < 20)  return 'text-[#f97316]'
  if (rate < 35)  return 'text-[#d94a3d]'
  return 'text-[#b84a8a]'
}

// ===== 动态列渲染 =====
// 表头/单元格渲染已共享化：纯数据列由 @/components/stock-table/primitives 的
// renderBuiltinDataCell 处理；symbol/signals/candle/ext 等需上下文的列由下方
// 表格 renderCell 回调处理。表格骨架使用 StockDataTable。

/** 渲染扩展数据列的值（含分隔/标签/展开配置） */
function renderExtValue(
  val: any,
  col: ColumnConfig,
  expanded: boolean,
  onToggle: () => void,
  inline?: boolean,
): React.ReactNode {
  if (val == null || Number.isNaN(val)) return <span className="text-muted">—</span>
  if (typeof val === 'number') {
    // int 类型不显示小数
    const displayVal = Number.isInteger(val) ? fmtPrice(val, 0) : fmtPrice(val)
    return <span className="tabular-nums">{displayVal}</span>
  }
  if (typeof val === 'boolean') {
    return <span className={val ? 'text-bull' : 'text-muted'}>{val ? '是' : '否'}</span>
  }

  // String — 按 extDisplay 配置渲染
  const cfg = col.extDisplay
  const str = String(val)

  // 纯文本模式
  if (cfg?.displayMode === 'text') {
    return <span className="text-foreground">{str}</span>
  }

  // 标签模式（默认）
  const separator = cfg?.separator?.trim() || null
  const tags = separator
    ? str.split(separator).map(s => s.trim()).filter(Boolean)
    : str.split(/[、,，;；\-]/).map(s => s.trim()).filter(Boolean)

  if (tags.length === 0) return <span className="text-muted">—</span>

  const maxTags = cfg?.maxTags ?? 0
  const showAll = maxTags <= 0 || expanded || tags.length <= maxTags
  const sliced = showAll ? tags : tags.slice(0, maxTags)
  const hiddenIndices = maxTags > 0 ? cfg?.hiddenIndices : undefined
  const visibleTags = hiddenIndices?.length
    ? sliced.filter((_, i) => !hiddenIndices.includes(i))
    : sliced
  const hiddenCount = tags.length - visibleTags.length

  // 竖向排列：仅在表格视图、收起状态、设定了显示上限时生效
  const isVertical = !inline && cfg?.tagLayout === 'vertical' && !expanded

  const tagEls = (
    <>
      {visibleTags.map((tag, i) => (
        <span key={i} className="inline-block px-1.5 py-px rounded text-[10px] font-medium leading-tight text-yellow-500 bg-yellow-500/10">
          {tag}
        </span>
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={onToggle}
          className="inline-block px-1.5 py-px rounded text-[10px] font-medium leading-tight text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
        >
          +{hiddenCount}
        </button>
      )}
      {showAll && maxTags > 0 && tags.length > maxTags && (
        <button
          onClick={onToggle}
          className="inline-block px-1.5 py-px rounded text-[10px] font-medium leading-tight text-muted hover:text-foreground transition-colors"
        >
          收起
        </button>
      )}
    </>
  )

  if (inline) {
    // 卡片视图：返回 inline 片段
    return tagEls
  }
  // 表格视图：用 <div> 包裹
  return <div className={isVertical ? 'flex flex-col items-start gap-0.5' : 'flex flex-wrap gap-0.5'}>{tagEls}</div>
}

/** 渲染扩展数据列的 <td> */
function renderExtCell(
  r: any,
  col: ColumnConfig,
  expandedCells: Set<string>,
  onToggleExpand: (key: string) => void,
): React.ReactNode {
  if (col.source.type !== 'ext') return null
  const { configId, fieldName } = col.source
  const val = r[`${configId}__${fieldName}`]
  const cellKey = `${r.symbol}::${col.id}`
  const expanded = expandedCells.has(cellKey)

  const style: React.CSSProperties = {}
  if (col.extDisplay?.maxWidth) {
    style.maxWidth = col.extDisplay.maxWidth
  }

  // 根据值类型决定 td class
  const tdClass = val == null || Number.isNaN(val)
    ? 'px-2 py-1.5 text-right num tabular-nums text-muted'
    : typeof val === 'number'
      ? 'px-2 py-1.5 text-right num tabular-nums'
      : typeof val === 'boolean'
        ? 'px-2 py-1.5 text-right'
        : 'px-2 py-1.5'

  return (
    <td className={tdClass} style={style}>
      {renderExtValue(val, col, expanded, () => onToggleExpand(cellKey))}
    </td>
  )
}

// ===== 搜索框组件（紧凑内联式）=====

function StockSearchBox({
  onPreview,
  existingSymbols,
  onAdd,
}: {
  onPreview: (symbol: string, name: string) => void
  existingSymbols: string[]
  onAdd: (symbol: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIdx, setActiveIdx] = useState(-1)

  const search = useQuery({
    queryKey: QK.instrumentSearch(query),
    queryFn: () => api.instrumentSearch(query),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  })

  const results = search.data?.results ?? []

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0) handleSelect(results[activeIdx])
      else if (results.length > 0) handleSelect(results[0])
    }
  }

  function handleSelect(r: { symbol: string; name: string }) {
    onPreview(r.symbol, r.name)
    setQuery('')
    setOpen(false)
    setActiveIdx(-1)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="搜索…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1) }}
          onFocus={() => { if (query.trim()) setOpen(true) }}
          onKeyDown={handleKeyDown}
          className="w-44 h-8 pl-8 pr-2.5 rounded-btn bg-elevated border border-border text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50 focus:w-56 transition-all duration-200"
        />
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-1 z-50 w-64 max-h-[320px] overflow-y-auto rounded-card border border-border bg-base shadow-xl"
          >
            {results.map((r, i) => {
              const inWatchlist = existingSymbols.includes(r.symbol)
              return (
                <div
                  key={r.symbol}
                  className={`flex items-center gap-2.5 px-3 py-2 text-xs transition-colors duration-100 ${
                    i === activeIdx ? 'bg-accent/10 text-accent' : 'hover:bg-elevated text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(r)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <span className="font-mono shrink-0 w-[80px]">{r.symbol}</span>
                    <span className="truncate text-secondary flex-1">{r.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onAdd(r.symbol) }}
                    disabled={inWatchlist}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      inWatchlist
                        ? 'text-accent bg-accent/10 cursor-default'
                        : 'text-muted hover:text-accent hover:bg-accent/10'
                    }`}
                    title={inWatchlist ? '已在观察池' : '加入观察池'}
                  >
                    {inWatchlist ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ===== 卡片组件 =====

function StockCard({
  r,
  candleRows,
  showCandle,
  onPreview,
  onConfirmRemove,
  onCancelRemove,
  onRequestRemove,
  confirmRemove,
  groupSummary,
  groupTitle,
  hasGroups,
  onOpenGroups,
  extCols,
  expandedCells,
  onToggleExpand,
}: {
  r: any
  candleRows: KlineRow[]
  showCandle: boolean
  onPreview: (symbol: string, name: string) => void
  onConfirmRemove: (symbol: string) => void
  onCancelRemove: () => void
  onRequestRemove: (symbol: string) => void
  confirmRemove: string | null
  groupSummary?: string
  groupTitle: string
  hasGroups: boolean
  onOpenGroups: (symbol: string, name?: string | null) => void
  extCols: ColumnConfig[]
  expandedCells: Set<string>
  onToggleExpand: (key: string) => void
}) {
  const board = boardTag(r.symbol)
  const price = r.rt_price ?? r.close
  const pct = r.rt_pct ?? r.change_pct
  const name = r.rt_name ?? r.name
  const signals = getSignals(r)
  const isUp = (pct ?? 0) > 0
  const isDown = (pct ?? 0) < 0

  // 动态背景渐变: 涨=红底, 跌=绿底, 平=无色
  const bgGlow = isUp
    ? 'bg-gradient-to-br from-bull/[0.06] via-transparent to-bull/[0.02]'
    : isDown
      ? 'bg-gradient-to-br from-bear/[0.06] via-transparent to-bear/[0.02]'
      : ''
  // 左侧指示条颜色
  const barColor = isUp ? 'bg-bull/70' : isDown ? 'bg-bear/70' : 'bg-muted/30'
  // 涨跌幅标签背景
  const pctBg = isUp ? 'bg-bull/12 text-bull' : isDown ? 'bg-bear/12 text-bear' : 'bg-elevated text-secondary'

  return (
    <div
      className={`relative rounded-lg border border-border bg-surface hover:border-border/80 transition-all duration-200 group cursor-pointer overflow-hidden ${bgGlow}`}
      onClick={() => onPreview(r.symbol, name ?? '')}
    >
      {/* 左侧彩色指示条 */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg ${barColor}`} />

      {/* 卡片操作区 */}
      <div className="absolute top-1.5 right-1.5 z-10">
        {confirmRemove === r.symbol ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onConfirmRemove(r.symbol)}
              className="px-1.5 py-0.5 rounded text-[10px] text-danger bg-danger/10 hover:bg-danger/20 transition-colors"
            >
              确认
            </button>
            <button onClick={() => onCancelRemove()} className="p-0.5 text-muted hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onOpenGroups(r.symbol, name)}
              className={`inline-flex h-6 max-w-[88px] items-center gap-1 rounded-btn border px-1.5 text-[10px] transition-all duration-150 ${
                hasGroups
                  ? 'border-accent/35 bg-accent/10 text-accent'
                  : 'border-border bg-base/80 text-muted opacity-0 hover:border-accent/35 hover:text-foreground group-hover:opacity-100'
              }`}
              title={groupTitle}
            >
              <Tags className="h-3 w-3 shrink-0" />
              {groupSummary && <span className="truncate">{groupSummary}</span>}
            </button>
            <button
              onClick={() => onRequestRemove(r.symbol)}
              className="rounded p-0.5 text-muted opacity-0 transition-all duration-150 hover:bg-elevated hover:text-danger group-hover:opacity-100"
              aria-label="移除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 卡片内容 */}
      <div className="pl-4 pr-2.5 pt-2.5 pb-0">
        {/* 第一行: 代码 + 名称 + 板块标识 */}
        <div className="flex items-center gap-1.5 min-w-0 mb-2">
          <span className="shrink-0 font-mono text-foreground text-xs tracking-wide">
            {r.symbol}
          </span>
          {name && (
            <span className="text-xs text-secondary truncate">{name}</span>
          )}
          {board && (
            <span className={`shrink-0 inline-flex items-center justify-center px-1 h-[16px] rounded text-[9px] font-bold leading-none ${board.color}`}>
              {board.label}
            </span>
          )}
          {r.consecutive_limit_ups > 0 && (
            <span className="shrink-0 inline-flex items-center justify-center px-1 h-[16px] rounded bg-danger/15 text-danger text-[9px] font-bold tabular-nums">
              {r.consecutive_limit_ups === 1 ? '首板' : `${r.consecutive_limit_ups}连`}
            </span>
          )}
        </div>

        {/* 第二行: 大价格 + 涨跌幅胶囊 */}
        <div className="flex items-end justify-between gap-2 mb-2">
          <span className={`text-xl tabular-nums tracking-tighter leading-none ${priceColorClass(pct)}`}>
            {fmtPrice(price)}
          </span>
          {pct != null && (
            <span className={`shrink-0 inline-flex items-center px-1.5 py-[2px] rounded text-[11px] tabular-nums ${pctBg}`}>
              {isUp ? '+' : ''}{pct.toFixed(2)}%
            </span>
          )}
        </div>

        {/* 第三行: 指标 */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted leading-relaxed">
          <span title="换手率">换手<span className={`font-mono ml-0.5 ${turnoverColor(r.turnover_rate)}`}>{r.turnover_rate != null ? `${r.turnover_rate.toFixed(2)}%` : '—'}</span></span>
          <span title="量比">量比<span className="font-mono ml-0.5">{fmtPrice(r.vol_ratio_5d)}</span></span>
          <span title="RSI14">RSI<span className="font-mono ml-0.5">{r.rsi_14 != null ? r.rsi_14.toFixed(1) : '—'}</span></span>
          {/* 扩展数据列展示在卡片中 */}
          {extCols.map(col => {
            if (col.source.type !== 'ext') return null
            const { configId, fieldName } = col.source
            const val = r[`${configId}__${fieldName}`]
            if (val == null) return null

            const cellKey = `${r.symbol}::${col.id}`
            const expanded = expandedCells.has(cellKey)

            return (
              <span key={col.id} title={col.label}>
                <span className="text-secondary">{fieldName}</span>
                <span className="font-mono ml-0.5">
                  {renderExtValue(val, col, expanded, () => onToggleExpand(cellKey), true)}
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* 信号标签区 */}
      {signals.length > 0 && (
        <div className="pl-4 pr-2.5 pt-1.5 pb-2 flex flex-wrap gap-1">
          {signals.slice(0, 3).map(s => (
            <span key={s.label} className={`inline-block px-1.5 py-[1px] rounded text-[9px] font-medium leading-tight ${signalCls(s.type)}`}>
              {s.label}
            </span>
          ))}
          {signals.length > 3 && (
            <span className="inline-block px-1 py-[1px] rounded text-[9px] text-muted bg-elevated leading-tight">
              +{signals.length - 3}
            </span>
          )}
        </div>
      )}

      {/* 迷你蜡烛图 */}
      {showCandle && candleRows.length > 0 && (
        <div className="border-t border-border/40 px-3 py-1.5">
          <MiniCandlestick rows={candleRows} height={32} />
        </div>
      )}
    </div>
  )
}

// ===== 主页面 =====

export function Watchlist() {
  const qc = useQueryClient()
  const [viewMode, setViewMode] = useState<'table' | 'card'>(() => {
    return (storage.watchlistView.get('table') as 'table' | 'card')
  })
  const [dailyKChartVisible, setDailyKChartVisible] = useState(() => {
    return storage.watchlistCandle.get(true)
  })

  // 列配置 — 从后端/localStorage 异步加载
  const [columns, setColumns] = useState<ColumnConfig[]>([...BUILTIN_COLUMNS])
  const [customizerOpen, setCustomizerOpen] = useState(false)
  const [groupPanelOpen, setGroupPanelOpen] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupSymbol, setGroupSymbol] = useState('')
  const [groupPicker, setGroupPicker] = useState<{ symbol: string; name?: string | null } | null>(null)
  const [groupPickerQuery, setGroupPickerQuery] = useState('')
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)
  const columnsLoaded = useRef(false)

  useEffect(() => {
    if (columnsLoaded.current) return
    columnsLoaded.current = true
    loadColumnConfig().then(setColumns)
  }, [])

  const handleColumnsChange = useCallback((next: ColumnConfig[]) => {
    setColumns(next)
    saveColumnConfig(next)
  }, [])

  const candleColumn = useMemo(() =>
    columns.find(c => c.source.type === 'builtin' && c.source.key === 'candle' && c.visible),
    [columns],
  )
  const candleColumnEnabled = !!candleColumn
  // 日k列渲染配置（来自列定制，已钳制边界）
  const candleResolved = useMemo(() => resolveCandleConfig(candleColumn?.candleConfig), [candleColumn])
  const candleDays = candleResolved.days
  const candleSize = dailyKChartVisible
    ? { width: candleResolved.enabledWidth, height: candleResolved.enabledHeight }
    : { width: candleResolved.disabledWidth, height: candleResolved.disabledHeight }

  const dailyKVisible = candleColumnEnabled && dailyKChartVisible

  // 计算可见列（列是否出现只由自定义列配置决定）
  const visibleColumns = useMemo(() => {
    return columns.filter(c => c.visible)
  }, [columns])

  // 计算 ext 列参数
  const extColumnsParam = useMemo(() => buildExtColumnsParam(columns), [columns])

  const toggleView = useCallback(() => {
    setViewMode(v => {
      const next = v === 'table' ? 'card' : 'table'
      storage.watchlistView.set(next)
      return next
    })
  }, [])
  const toggleDailyKChart = useCallback(() => {
    setDailyKChartVisible(v => {
      const next = !v
      storage.watchlistCandle.set(next)
      return next
    })
  }, [])
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState<string>('')
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())
  const closePreview = useCallback(() => {
    setPreviewSymbol(null)
    setPreviewName('')
  }, [])

  const handleToggleExpand = useCallback((cellKey: string) => {
    setExpandedCells(prev => {
      const next = new Set(prev)
      if (next.has(cellKey)) next.delete(cellKey)
      else next.add(cellKey)
      return next
    })
  }, [])

  const list = useQuery({
    queryKey: QK.watchlist,
    queryFn: api.watchlistList,
  })

  const allSymbols = useMemo(
    () => list.data?.symbols?.map(s => s.symbol) ?? [],
    [list.data?.symbols],
  )

  const groupPreview = useQuery({
    queryKey: QK.watchlistGroupPreview,
    queryFn: api.watchlistGroupPreview,
  })
  const groupMemberships = groupPreview.data?.memberships ?? {}

  // enriched 数据 — 传入 ext_columns 参数
  const enriched = useQuery({
    queryKey: QK.watchlistEnriched(extColumnsParam),
    queryFn: () => api.watchlistEnriched(extColumnsParam || undefined),
    enabled: (list.data?.symbols.length ?? 0) > 0,
  })

  const symbols = enriched.data?.rows?.map((r: any) => r.symbol) ?? []
  const symbolsKey = symbols.join(',')

  // 批量日k数据 (天数由列配置决定)
  const klineBatch = useQuery({
    queryKey: QK.watchlistKlineBatch(`${symbolsKey}|${candleDays}`),
    queryFn: () => api.klineDailyBatch(symbols, candleDays),
    enabled: dailyKVisible && symbols.length > 0,
    staleTime: 5 * 60_000,  // 5 分钟内不重请求
  })

  const klineData = dailyKVisible ? (klineBatch.data?.data ?? {}) : {}

  const addMutation = useMutation({
    mutationFn: (sym: string) => api.watchlistAdd(sym),
    onSuccess: (data) => {
      qc.setQueryData(QK.watchlist, data)
      qc.invalidateQueries({ queryKey: QK.watchlist })
      qc.invalidateQueries({ queryKey: ['watchlist-enriched'] })
      qc.invalidateQueries({ queryKey: ['watchlist-kline-batch'] })
      qc.invalidateQueries({ queryKey: QK.watchlistGroupPreview })
      qc.invalidateQueries({ queryKey: QK.focusUniverse })
    },
  })

  const remove = useMutation({
    mutationFn: (sym: string) => api.watchlistRemove(sym),
    onSuccess: (_data, sym) => {
      // 1. 立即从 enriched 缓存中移除该股票，UI 即时更新
      qc.setQueryData(['watchlist-enriched', extColumnsParam], (old: any) => {
        if (!old?.rows) return old
        return { ...old, rows: old.rows.filter((r: any) => r.symbol !== sym) }
      })
      // 2. 清除 list 缓存，触发后台 refetch
      qc.invalidateQueries({ queryKey: QK.watchlist })
      qc.invalidateQueries({ queryKey: QK.watchlistEnriched() })
      qc.invalidateQueries({ queryKey: QK.watchlistKlineBatch('') })
      qc.invalidateQueries({ queryKey: QK.watchlistGroupPreview })
      qc.invalidateQueries({ queryKey: QK.focusUniverse })
    },
  })

  const clearAll = useMutation({
    mutationFn: () => api.watchlistClear(),
    onSuccess: () => {
      setConfirmClear(false)
      // 立即清空 enriched 缓存
      qc.setQueryData(['watchlist-enriched', extColumnsParam], { rows: [], as_of: null, elapsed_ms: 0 })
      qc.invalidateQueries({ queryKey: QK.watchlist })
      qc.invalidateQueries({ queryKey: QK.watchlistEnriched() })
      qc.invalidateQueries({ queryKey: QK.watchlistKlineBatch('') })
      qc.invalidateQueries({ queryKey: QK.watchlistGroupPreview })
      qc.invalidateQueries({ queryKey: QK.focusUniverse })
    },
  })

  const refreshGroups = useCallback(() => {
    qc.invalidateQueries({ queryKey: QK.watchlistGroupPreview })
    qc.invalidateQueries({ queryKey: QK.focusUniverse })
  }, [qc])

  const createGroup = useMutation({
    mutationFn: () => api.createWatchlistGroup({ name: groupName.trim() }),
    onSuccess: () => {
      setGroupName('')
      refreshGroups()
    },
  })

  const createGroupFromPicker = useMutation({
    mutationFn: (name: string) => api.createWatchlistGroup({ name: name.trim() }),
    onSuccess: () => {
      refreshGroups()
    },
  })

  const deleteGroup = useMutation({
    mutationFn: (groupId: string) => api.deleteWatchlistGroup(groupId),
    onSuccess: () => {
      setConfirmDeleteGroupId(null)
      refreshGroups()
    },
  })

  const setSymbolGroups = useMutation({
    mutationFn: ({ symbol, groupIds }: { symbol: string; groupIds: string[] }) =>
      api.setWatchlistSymbolGroups(symbol, groupIds),
    onSuccess: refreshGroups,
  })

  // 二次确认状态
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const rows = enriched.data?.rows ?? []
  const missingCount = enriched.data?.missing_symbols?.length ?? rows.filter((r: any) => r._missing_enriched).length

  useEffect(() => {
    if (!allSymbols.length) {
      if (groupSymbol) setGroupSymbol('')
      return
    }
    if (!groupSymbol || !allSymbols.includes(groupSymbol)) {
      setGroupSymbol(allSymbols[0])
    }
  }, [allSymbols, groupSymbol])

  const customGroups = groupPreview.data?.custom ?? []
  const autoGroups = groupPreview.data?.auto ?? []
  const filteredPickerGroups = useMemo(() => {
    const keyword = groupPickerQuery.trim().toLowerCase()
    if (!keyword) return customGroups
    return customGroups.filter(group => (
      group.name.toLowerCase().includes(keyword) ||
      group.id.toLowerCase().includes(keyword)
    ))
  }, [customGroups, groupPickerQuery])
  const pickerGroupIds = groupPicker ? (groupMemberships[groupPicker.symbol] ?? []) : []
  const customGroupIdSet = useMemo(() => new Set(customGroups.map(group => group.id)), [customGroups])
  const pickerCustomGroupIds = useMemo(
    () => pickerGroupIds.filter((id: string) => customGroupIdSet.has(id)),
    [customGroupIdSet, pickerGroupIds],
  )
  const pickerCustomGroupSet = useMemo(() => new Set(pickerCustomGroupIds), [pickerCustomGroupIds])
  const pickerCustomGroups = useMemo(
    () => customGroups.filter(group => pickerCustomGroupSet.has(group.id)),
    [customGroups, pickerCustomGroupSet],
  )
  const canCreatePickerGroup = !!groupPickerQuery.trim() && !customGroups.some(
    group => group.name.trim().toLowerCase() === groupPickerQuery.trim().toLowerCase(),
  )
  const conceptGroups = useMemo(
    () => autoGroups.filter(group => group.source === 'concept').sort((a, b) => b.count - a.count),
    [autoGroups],
  )
  const otherAutoGroups = useMemo(
    () => autoGroups.filter(group => group.source !== 'concept').sort((a, b) => b.count - a.count),
    [autoGroups],
  )
  const groupFilterOptions = useMemo(
    () => [...customGroups, ...autoGroups],
    [customGroups, autoGroups],
  )
  const activeGroup = useMemo(
    () => groupFilterOptions.find(group => group.id === activeGroupId) ?? null,
    [groupFilterOptions, activeGroupId],
  )
  const quickCustomGroups = useMemo(() => {
    const pinned = activeGroup?.kind === 'custom' ? [activeGroup] : []
    const custom = customGroups.filter(group => group.id !== activeGroupId)
    return [...pinned, ...custom].slice(0, 10)
  }, [activeGroup, activeGroupId, customGroups])
  const quickConceptGroups = useMemo(() => {
    const pinned = activeGroup?.source === 'concept' ? [activeGroup] : []
    const concepts = conceptGroups.filter(group => group.id !== activeGroupId)
    return [...pinned, ...concepts].slice(0, 18)
  }, [activeGroup, activeGroupId, conceptGroups])
  const activeGroupSymbols = useMemo(
    () => new Set(activeGroup?.symbols ?? []),
    [activeGroup],
  )
  const selectedGroupIds = groupSymbol ? (groupMemberships[groupSymbol] ?? []) : []
  const selectedGroupSet = useMemo(() => new Set(selectedGroupIds), [selectedGroupIds])
  const toggleSymbolGroup = useCallback((groupId: string) => {
    if (!groupSymbol) return
    const next = selectedGroupSet.has(groupId)
      ? selectedGroupIds.filter(id => id !== groupId)
      : [...selectedGroupIds, groupId]
    setSymbolGroups.mutate({ symbol: groupSymbol, groupIds: next })
  }, [groupSymbol, selectedGroupIds, selectedGroupSet, setSymbolGroups])

  const setSymbolCustomGroups = useCallback((symbol: string, groupIds: string[]) => {
    if (!symbol) return
    setSymbolGroups.mutate({ symbol, groupIds })
  }, [setSymbolGroups])

  const togglePickerGroup = useCallback((groupId: string) => {
    if (!groupPicker) return
    const next = pickerCustomGroupSet.has(groupId)
      ? pickerCustomGroupIds.filter(id => id !== groupId)
      : [...pickerCustomGroupIds, groupId]
    setSymbolCustomGroups(groupPicker.symbol, next)
  }, [groupPicker, pickerCustomGroupIds, pickerCustomGroupSet, setSymbolCustomGroups])

  const openGroupPicker = useCallback((symbol: string, name?: string | null) => {
    setGroupPicker({ symbol, name })
    setGroupPickerQuery('')
  }, [])

  const closeGroupPicker = useCallback(() => {
    setGroupPicker(null)
    setGroupPickerQuery('')
  }, [])

  useEffect(() => {
    if (activeGroupId && !groupFilterOptions.some(group => group.id === activeGroupId)) {
      setActiveGroupId(null)
    }
  }, [activeGroupId, groupFilterOptions])

  // ===== 筛选 =====
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<Record<string, { min?: string; max?: string; text?: string }>>({})

  // 板块筛选（持久化）
  const [boardFilter, setBoardFilter] = useState<Set<string>>(() => {
    const saved = storage.watchlistBoardFilter.get([])
    return saved.length > 0 ? new Set(saved) : new Set(BOARDS) // 默认全选
  })
  const persistBoardFilter = useCallback((next: Set<string>) => {
    setBoardFilter(next)
    storage.watchlistBoardFilter.set([...next])
  }, [])

  const toggleBoard = useCallback((board: string) => {
    setBoardFilter(prev => {
      const next = new Set(prev)
      if (next.has(board)) next.delete(board)
      else next.add(board)
      persistBoardFilter(next)
      return next
    })
  }, [persistBoardFilter])

  const updateFilter = useCallback((colId: string, patch: { min?: string; max?: string; text?: string }) => {
    setFilters(prev => {
      const next = { ...prev }
      const existing = next[colId] || {}
      const merged = { ...existing, ...patch }
      if (!merged.min && !merged.max && !merged.text) {
        delete next[colId]
      } else {
        next[colId] = merged
      }
      return next
    })
  }, [])

  const clearFilters = useCallback(() => setFilters({}), [])

  // 可筛选的内置列
  const filterableBuiltinCols = useMemo(
    () => columns.filter(c => c.source.type === 'builtin' && !UNSORTABLE_KEYS.has(c.source.key) && c.id !== 'builtin:symbol'),
    [columns],
  )

  // 按类别索引（复用列配置的分组定义）
  const colsByCategory = useMemo(() => {
    const map: Record<string, { id: string; label: string; col: typeof filterableBuiltinCols[number] }[]> = {}
    for (const cat of COLUMN_GROUPS) {
      map[cat.label] = []
      for (const key of cat.keys) {
        const col = filterableBuiltinCols.find(c => c.source.type === 'builtin' && c.source.key === key)
        if (col) map[cat.label].push({ id: col.id, label: col.label, col })
      }
    }
    return map
  }, [filterableBuiltinCols])

  // 筛选 + 排序
  const filteredRows = useMemo(() => {
    // 板块筛选（全选时跳过）
    let result = rows
    if (activeGroup) {
      result = result.filter(r => activeGroupSymbols.has(r.symbol))
    }
    if (boardFilter.size > 0 && boardFilter.size < BOARDS.length) {
      result = result.filter(r => {
        const board = getBoardType(r.symbol)
        return board != null && boardFilter.has(board)
      })
    }
    // 数值/文本筛选
    const activeFilters = Object.entries(filters).filter(([, v]) => v.min || v.max || v.text)
    if (activeFilters.length > 0) {
      result = result.filter(r => {
        for (const [colId, f] of activeFilters) {
          const col = columns.find(c => c.id === colId)
          if (!col) continue
          const val = getSortValue(r, col)
          if (val == null) return false
          if (typeof val === 'number') {
            if (f.min && val < Number(f.min)) return false
            if (f.max && val > Number(f.max)) return false
          } else {
            if (f.text && !String(val).includes(f.text)) return false
          }
        }
        return true
      })
    }
    return result
  }, [rows, filters, columns, boardFilter, activeGroup, activeGroupSymbols])

  const activeFilterCount = Object.values(filters).filter(v => v.min || v.max || v.text).length

  // 排序（复用共享三态排序 hook）
  const { sort, toggle: handleSortToggle, sortRows } = useTableSort()

  const sortedRows = useMemo(
    () => sortRows(filteredRows, columns),
    [filteredRows, sortRows, columns],
  )

  // 可见的 ext 列（卡片视图使用）
  const visibleExtCols = useMemo(
    () => visibleColumns.filter(c => c.source.type === 'ext'),
    [visibleColumns]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="观察池"
        subtitle={`${sortedRows.length}/${allSymbols.length} 只${activeGroup ? ` · ${activeGroup.name}` : ''}${missingCount ? ` · 待同步 ${missingCount}` : ''}`}
        right={
          <div className="flex items-center gap-2">
            {/* 筛选 / 搜索 */}
            <button
              onClick={() => setFilterOpen(v => !v)}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-btn transition-colors duration-150 ease-smooth ${
                filterOpen || activeFilterCount > 0
                  ? 'bg-accent/15 text-accent hover:bg-accent/25'
                  : 'bg-elevated text-secondary hover:bg-elevated/80'
              }`}
              title={`筛选${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
            >
              <Filter className="h-4 w-4" />
            </button>
            <button
              onClick={() => setGroupPanelOpen(v => !v)}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-btn transition-colors duration-150 ease-smooth ${
                groupPanelOpen || activeGroup
                  ? 'bg-accent/15 text-accent hover:bg-accent/25'
                  : 'bg-elevated text-secondary hover:bg-elevated/80'
              }`}
              title={activeGroup ? `当前分组：${activeGroup.name}` : '观察池分组'}
            >
              <Tags className="h-4 w-4" />
            </button>
            <StockSearchBox
              onPreview={(sym, name) => { setPreviewSymbol(sym); setPreviewName(name) }}
              existingSymbols={allSymbols as string[]}
              onAdd={(sym) => addMutation.mutate(sym)}
            />
            <div className="w-px h-5 bg-border" />
            {/* 视图 */}
            <button
              onClick={toggleView}
              className="inline-flex items-center justify-center h-8 w-8 rounded-btn bg-elevated hover:bg-elevated/80 text-secondary hover:text-foreground transition-colors duration-150 ease-smooth"
              title={viewMode === 'table' ? '卡片视图' : '列表视图'}
            >
              {viewMode === 'table' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
            </button>
            <div className="w-px h-5 bg-border" />
            {/* 自定义列 / 刷新 */}
            <button
              onClick={() => setCustomizerOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-btn bg-elevated hover:bg-elevated/80 text-secondary hover:text-foreground transition-colors duration-150 ease-smooth"
              title="自定义列"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => enriched.refetch()}
              disabled={enriched.isFetching}
              className="inline-flex items-center justify-center h-8 w-8 rounded-btn bg-elevated hover:bg-elevated/80 text-secondary hover:text-foreground transition-colors duration-150 ease-smooth disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw className={`h-4 w-4 ${enriched.isFetching ? 'animate-spin' : ''}`} />
            </button>
            {allSymbols.length > 0 && (
              <>
                <div className="w-px h-5 bg-border" />
                <button
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-btn bg-danger/10 text-danger hover:bg-danger/20 transition-colors duration-150 ease-smooth"
                  title="清空观察池"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="border-b border-border bg-base/95 px-5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveGroupId(null)}
            className={`h-7 shrink-0 rounded-btn border px-3 text-xs transition-colors ${
              !activeGroup
                ? 'border-accent/45 bg-accent/15 text-accent'
                : 'border-border bg-surface text-secondary hover:border-accent/35 hover:text-foreground'
            }`}
          >
            全部
            <span className="ml-1 font-mono text-[10px] opacity-70">{allSymbols.length}</span>
          </button>
          <span className="shrink-0 text-[10px] font-medium text-muted">自定义</span>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pr-1">
            {quickCustomGroups.length > 0 ? quickCustomGroups.map(group => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveGroupId(group.id)}
                className={`inline-flex h-7 max-w-[180px] shrink-0 items-center gap-1 rounded-btn border px-2.5 text-xs transition-colors ${
                  activeGroupId === group.id
                    ? 'border-accent/45 bg-accent/15 text-accent'
                    : 'border-border bg-surface text-secondary hover:border-accent/35 hover:text-foreground'
                }`}
                title={`${group.name} · ${group.count} 只`}
              >
                <span className="truncate">{group.name}</span>
                <span className="font-mono text-[10px] opacity-70">{group.count}</span>
              </button>
            )) : (
              <span className="inline-flex h-7 items-center text-xs text-muted">暂无自定义分组</span>
            )}
          </div>
          <select
            value={activeGroupId ?? ''}
            onChange={e => setActiveGroupId(e.target.value || null)}
            className="h-7 w-36 shrink-0 rounded-btn border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
            title="选择全部维度"
          >
            <option value="">全部维度</option>
            {customGroups.length > 0 && (
              <optgroup label="自定义分组">
                {customGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.name} · {group.count}</option>
                ))}
              </optgroup>
            )}
            {conceptGroups.length > 0 && (
              <optgroup label="概念标签">
                {conceptGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.name} · {group.count}</option>
                ))}
              </optgroup>
            )}
            {otherAutoGroups.length > 0 && (
              <optgroup label="行业/市场">
                {otherAutoGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.name} · {group.count}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={() => setGroupPanelOpen(v => !v)}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-btn transition-colors ${
              groupPanelOpen
                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'bg-elevated text-secondary hover:bg-elevated/80 hover:text-foreground'
            }`}
            title="管理分组"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {conceptGroups.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[10px] font-medium text-muted">概念</span>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pr-1">
              {quickConceptGroups.map(group => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupId(group.id)}
                  className={`inline-flex h-7 max-w-[170px] shrink-0 items-center gap-1 rounded-btn border px-2.5 text-xs transition-colors ${
                    activeGroupId === group.id
                      ? 'border-warning/45 bg-warning/15 text-warning'
                      : 'border-border bg-surface text-secondary hover:border-warning/35 hover:text-foreground'
                  }`}
                  title={`${group.name} · ${group.count} 只`}
                >
                  <span className="truncate">{group.name}</span>
                  <span className="font-mono text-[10px] opacity-70">{group.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {activeGroup && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            <span>{groupSourceLabel(activeGroup.source)}</span>
            <span className="text-border">/</span>
            <span className="truncate text-accent">{activeGroup.name}</span>
            <span className="font-mono">{sortedRows.length}/{activeGroup.count}</span>
          </div>
        )}
      </div>

      {/* 筛选栏 */}
      {filterOpen && (
        <div className="px-5 py-2 border-b border-border bg-surface/50 max-h-[184px] overflow-y-auto">
          {/* 板块筛选 */}
          <div className="mb-2">
            <div className="text-[10px] text-muted uppercase tracking-wider mb-0.5">板块</div>
            <div className="flex flex-wrap gap-1">
              {BOARDS.map(board => {
                const active = boardFilter.has(board)
                return (
                  <button
                    key={board}
                    onClick={() => toggleBoard(board)}
                    className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                      active
                        ? 'bg-accent/15 text-accent'
                        : 'bg-elevated text-secondary hover:text-foreground hover:bg-elevated/80'
                    }`}
                  >
                    {board}
                  </button>
                )
              })}
            </div>
          </div>
          {COLUMN_GROUPS.map(cat => {
            const items = colsByCategory[cat.label]?.filter(i => i.col)
            if (!items?.length) return null
            return (
              <div key={cat.label} className="mb-1.5 last:mb-0">
                <div className="text-[10px] text-muted uppercase tracking-wider mb-0.5">{cat.label}</div>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {items.map(item => {
                    const f = filters[item.id] || {}
                    const hasFilter = !!f.min || !!f.max || !!f.text
                    return (
                      <div key={item.id} className="flex items-center gap-0.5 text-[11px]">
                        <span className={`whitespace-nowrap ${hasFilter ? 'text-accent' : 'text-secondary'}`}>{item.label}</span>
                        <input
                          type="number"
                          value={f.min ?? ''}
                          onChange={e => updateFilter(item.id, { min: e.target.value })}
                          placeholder="min"
                          className={`w-12 h-5 rounded border text-[10px] px-1 placeholder:text-muted focus:outline-none ${
                            hasFilter ? 'border-accent/30 bg-accent/5' : 'border-border bg-elevated'
                          } text-foreground focus:border-accent/50`}
                        />
                        <span className="text-muted">~</span>
                        <input
                          type="number"
                          value={f.max ?? ''}
                          onChange={e => updateFilter(item.id, { max: e.target.value })}
                          placeholder="max"
                          className={`w-12 h-5 rounded border text-[10px] px-1 placeholder:text-muted focus:outline-none ${
                            hasFilter ? 'border-accent/30 bg-accent/5' : 'border-border bg-elevated'
                          } text-foreground focus:border-accent/50`}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="mt-1 text-[10px] text-danger hover:text-danger/80 transition-colors">
              清除全部筛选
            </button>
          )}
        </div>
      )}

      {groupPanelOpen && (
        <div className="border-b border-border bg-surface/50 px-5 py-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0 rounded-card border border-border bg-base/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">自定义分组</div>
                <span className="font-mono text-[11px] text-muted">{customGroups.length}</span>
              </div>
              <div className="mb-2 flex gap-2">
                <input
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && groupName.trim()) createGroup.mutate()
                  }}
                  placeholder="新分组名称"
                  className="h-8 min-w-0 flex-1 rounded-btn border border-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => createGroup.mutate()}
                  disabled={!groupName.trim() || createGroup.isPending}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                  title="新建分组"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-36 overflow-auto rounded-btn border border-border bg-surface/60">
                {customGroups.length > 0 ? customGroups.map(group => (
                  <div
                    key={group.id}
                    className={`flex items-center justify-between gap-2 border-b border-border/50 px-2.5 py-2 text-xs last:border-b-0 ${
                      activeGroupId === group.id ? 'bg-accent/10' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveGroupId(group.id)}
                      className="min-w-0 flex-1 text-left"
                      title={`切换到 ${group.name}`}
                    >
                      <span className="block truncate text-foreground">{group.name}</span>
                      <span className="font-mono text-[10px] text-muted">{group.count} 只</span>
                    </button>
                    {confirmDeleteGroupId === group.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => deleteGroup.mutate(group.id)}
                          disabled={deleteGroup.isPending}
                          className="h-6 rounded-btn bg-danger/10 px-2 text-[10px] text-danger hover:bg-danger/20 disabled:opacity-40"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteGroupId(null)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-btn text-muted hover:bg-elevated hover:text-foreground"
                          title="取消"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteGroupId(group.id)}
                        disabled={deleteGroup.isPending}
                        className="shrink-0 rounded p-1 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                        title="删除分组"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )) : (
                  <div className="px-3 py-3 text-xs text-muted">暂无自定义分组</div>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded-card border border-border bg-base/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">股票分组</div>
                <select
                  value={groupSymbol}
                  onChange={e => setGroupSymbol(e.target.value)}
                  className="h-8 max-w-[190px] rounded-btn border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
                >
                  {allSymbols.map(symbol => (
                    <option key={symbol} value={symbol}>{symbol}</option>
                  ))}
                </select>
              </div>
              <div className="max-h-44 overflow-auto rounded-btn border border-border bg-surface/60">
                {customGroups.length > 0 ? customGroups.map(group => (
                  <label key={group.id} className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs last:border-b-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedGroupSet.has(group.id)}
                        onChange={() => toggleSymbolGroup(group.id)}
                        disabled={!groupSymbol || setSymbolGroups.isPending}
                        className="h-3.5 w-3.5 shrink-0 accent-accent"
                      />
                      <span className="truncate text-foreground">{group.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-muted">{group.count}</span>
                  </label>
                )) : (
                  <div className="px-3 py-3 text-xs text-muted">先创建自定义分组</div>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded-card border border-border bg-base/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">概念标签</div>
                <span className="font-mono text-[11px] text-muted">{conceptGroups.length}</span>
              </div>
              <div className="max-h-28 overflow-auto rounded-btn border border-border bg-surface/60">
                {conceptGroups.length > 0 ? conceptGroups.slice(0, 60).map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroupId(group.id)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-xs last:border-b-0 transition-colors hover:bg-elevated/50 ${
                      activeGroupId === group.id ? 'bg-warning/10' : ''
                    }`}
                    title={`切换到 ${group.name}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{group.name}</span>
                      <span className="text-[10px] text-muted">系统概念</span>
                    </span>
                    <span className="shrink-0 font-mono text-muted">{group.count}</span>
                  </button>
                )) : (
                  <div className="px-3 py-3 text-xs text-muted">暂无概念数据</div>
                )}
              </div>
              <div className="mb-2 mt-3 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">行业/市场</div>
                <span className="font-mono text-[11px] text-muted">{otherAutoGroups.length}</span>
              </div>
              <div className="max-h-28 overflow-auto rounded-btn border border-border bg-surface/60">
                {otherAutoGroups.length > 0 ? otherAutoGroups.slice(0, 60).map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroupId(group.id)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-xs last:border-b-0 transition-colors hover:bg-elevated/50 ${
                      activeGroupId === group.id ? 'bg-accent/10' : ''
                    }`}
                    title={`切换到 ${group.name}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{group.name}</span>
                      <span className="text-[10px] text-muted">{group.source === 'industry' ? '行业' : group.source === 'exchange' ? '市场' : '自动'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-muted">{group.count}</span>
                  </button>
                )) : (
                  <div className="px-3 py-3 text-xs text-muted">暂无行业/市场数据</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 可滚动列表区 — 占满剩余高度，内部独立滚动，表头 sticky 固定 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-3">
          {/* 列表 */}
          {list.isLoading && <div className="text-sm text-muted">加载中…</div>}
          {list.isError && <div className="text-sm text-danger">读取观察池失败</div>}

          {allSymbols.length === 0 ? (
            <EmptyState
              icon={Star}
              title="观察池为空"
              hint="点击右上角搜索按钮查找并预览标的，进入个股详情后可加入观察池。"
            />
          ) : viewMode === 'table' ? (
            <div className="space-y-2">
              <StockDataTable
                columns={visibleColumns}
                rows={sortedRows}
                headerSticky
                sort={sort}
                onSortToggle={handleSortToggle}
                rowKey={(r: any) => r.symbol}
                rowClassName={(r: any) => `border-t border-border hover:bg-elevated/50 transition-colors duration-150 ease-smooth ${r._missing_enriched ? 'opacity-60' : ''}`}
                // 日k列表头：标签 + 显示/隐藏眼睛按钮
                renderHeaderContent={(col) => {
                  if (col.source.type === 'builtin' && col.source.key === 'symbol') {
                    return '名称/代码'
                  }
                  if (col.source.type === 'builtin' && col.source.key === 'candle') {
                    return (
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span>{col.label}</span>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); toggleDailyKChart() }}
                          className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
                            dailyKChartVisible
                              ? 'text-accent bg-accent/10 hover:bg-accent/20'
                              : 'text-muted hover:text-foreground hover:bg-elevated'
                          }`}
                          title={dailyKChartVisible ? '隐藏日k蜡烛' : '显示日k蜡烛'}
                          aria-label={dailyKChartVisible ? '隐藏日k蜡烛' : '显示日k蜡烛'}
                        >
                          {dailyKChartVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                      </span>
                    )
                  }
                  return undefined
                }}
                renderCell={(r: any, col: ColumnConfig) => {
                // ext 列
                if (col.source.type === 'ext') {
                  return renderExtCell(r, col, expandedCells, handleToggleExpand)
                }
                const key = col.source.key
                const price = r.rt_price ?? r.close
                const pct = r.rt_pct ?? r.change_pct
                const name = r.rt_name ?? r.name
                // 自选页 symbol 列：预览 + 内嵌删除（减号图标，二次确认）
                if (key === 'symbol') {
                  const board = boardTag(r.symbol)
                  const displayName = name || r.symbol
                  const nameColor = pct == null || Number.isNaN(pct) || pct === 0
                    ? 'text-foreground'
                    : priceColorClass(pct)
                  return (
                    <td className="px-2 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setPreviewSymbol(r.symbol); setPreviewName(name ?? '') }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className={`block truncate text-sm font-medium leading-5 transition-colors duration-150 ${nameColor}`}>
                            {displayName}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1">
                            <span className="truncate font-mono text-[11px] leading-4 text-muted group-hover:text-secondary transition-colors duration-150">
                              {r.symbol}
                            </span>
                            {board ? (
                              <span className={`shrink-0 inline-flex items-center justify-center rounded border px-1 py-px text-[9px] font-bold leading-none ${board.color}`}>
                                {board.label}
                              </span>
                            ) : null}
                            {r._missing_enriched ? (
                              <span className="shrink-0 rounded border border-warning/25 bg-warning/10 px-1 py-px text-[9px] font-medium text-warning">
                                待同步
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </div>
                    </td>
                  )
                }
                // 实时行情列：price/pct/amount 使用 rt_ 回退（自选页有实时推送）
                const numCls = 'px-2 py-1.5 text-right num tabular-nums'
                if (key === 'price') {
                  return <td className={`${numCls} ${priceColorClass(pct)}`}>{fmtPrice(price)}</td>
                }
                if (key === 'pct') {
                  return <td className={`${numCls} ${priceColorClass(pct)}`}>{fmtPct(pct)}</td>
                }
                if (key === 'amount') {
                  return <td className={`${numCls} text-secondary`}>{fmtBigNum(r.rt_amount ?? r.amount)}</td>
                }
                if (key === 'turnover') {
                  return <td className={`${numCls} ${turnoverColor(r.turnover_rate)}`}>{r.turnover_rate != null ? `${r.turnover_rate.toFixed(2)}%` : '—'}</td>
                }
                // 信号列
                if (key === 'signals') {
                  const signals = getSignals(r)
                  return (
                    <td className="px-2 py-1.5">
                      {signals.length > 0 && (
                        <div className="flex flex-wrap gap-0.5">
                          {signals.slice(0, 3).map((s) => (
                            <span key={s.label} className={`inline-block px-1.5 py-px rounded text-[10px] font-medium leading-tight ${signalCls(s.type)}`}>
                              {s.label}
                            </span>
                          ))}
                          {signals.length > 3 && (
                            <span className="text-[10px] text-muted">+{signals.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                }
                // 日k列
                if (key === 'candle') {
                  return (
                    <td
                      className="px-2 py-1.5"
                      style={{ width: candleSize.width, minWidth: candleSize.width, maxWidth: candleSize.width, height: candleSize.height }}
                    >
                      <MiniCandlestick rows={klineData[r.symbol] ?? []} width={candleSize.width} height={candleSize.height} />
                    </td>
                  )
                }
                // 其余纯数据列 → 共享原语
                return renderBuiltinDataCell(r, col)
              }}
                extraHeader={<span className="inline-flex items-center justify-end gap-1">操作</span>}
                renderExtraCol={(r: any) => {
                  const rowGroupIds = groupMemberships[r.symbol] ?? []
                  const rowCustomGroups = customGroups.filter(group => rowGroupIds.includes(group.id))
                  const groupSummary = customGroupSummary(rowCustomGroups)
                  const groupTitle = customGroupTitle(r.symbol, rowCustomGroups, customGroups.length > 0)
                  return (
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openGroupPicker(r.symbol, r.rt_name ?? r.name)}
                          disabled={setSymbolGroups.isPending}
                          className={`inline-flex h-7 w-32 items-center justify-between gap-1 rounded-btn border px-2 text-[11px] outline-none transition-colors disabled:opacity-50 ${
                            rowCustomGroups.length
                              ? 'border-accent/35 bg-accent/10 text-accent hover:bg-accent/15'
                              : 'border-border bg-surface text-secondary hover:border-accent/35 hover:text-foreground'
                          }`}
                          title={groupTitle}
                        >
                          <Tags className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-left">{groupSummary ?? '设分组'}</span>
                        </button>
                        {confirmRemove === r.symbol ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { remove.mutate(r.symbol); setConfirmRemove(null) }}
                              className="h-7 rounded-btn bg-danger/10 px-2 text-[11px] text-danger hover:bg-danger/20"
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemove(null)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-btn text-muted hover:bg-elevated hover:text-foreground"
                              title="取消"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(r.symbol)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-btn text-muted hover:bg-danger/10 hover:text-danger"
                            title="移出观察池"
                            aria-label="移出观察池"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )
                }}
                className="rounded-card overflow-x-auto"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {sortedRows.map((r: any) => {
                const rowGroupIds = groupMemberships[r.symbol] ?? []
                const rowCustomGroups = customGroups.filter(group => rowGroupIds.includes(group.id))
                return (
                  <StockCard
                    key={r.symbol}
                    r={r}
                    candleRows={klineData[r.symbol] ?? []}
                    showCandle={dailyKVisible}
                    onPreview={(sym, name) => { setPreviewSymbol(sym); setPreviewName(name) }}
                    onConfirmRemove={(sym) => { remove.mutate(sym); setConfirmRemove(null) }}
                    onCancelRemove={() => setConfirmRemove(null)}
                    onRequestRemove={(sym) => setConfirmRemove(sym)}
                    confirmRemove={confirmRemove}
                    groupSummary={customGroupSummary(rowCustomGroups)}
                    groupTitle={customGroupTitle(r.symbol, rowCustomGroups, customGroups.length > 0)}
                    hasGroups={rowCustomGroups.length > 0}
                    onOpenGroups={openGroupPicker}
                    extCols={visibleExtCols}
                    expandedCells={expandedCells}
                    onToggleExpand={handleToggleExpand}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 单股归组弹窗 */}
      <AnimatePresence>
        {groupPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
              onClick={closeGroupPicker}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-[92vw] max-w-[440px] rounded-card border border-border bg-base shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">选择分组</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span className="truncate text-secondary">{groupPicker.name || groupPicker.symbol}</span>
                    <span className="font-mono">{groupPicker.symbol}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeGroupPicker}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-elevated hover:text-foreground"
                  title="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input
                    autoFocus
                    value={groupPickerQuery}
                    onChange={e => setGroupPickerQuery(e.target.value)}
                    placeholder="搜索分组，或输入新分组名"
                    className="h-9 w-full rounded-btn border border-border bg-surface pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">
                    当前：
                    <span className={pickerCustomGroups.length ? 'text-accent' : 'text-secondary'}>
                      {pickerCustomGroups.length
                        ? `${pickerCustomGroups.length} 个分组`
                        : '未分组'}
                    </span>
                  </span>
                  {pickerCustomGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSymbolCustomGroups(groupPicker.symbol, [])
                      }}
                      className="rounded-btn px-2 py-1 text-muted hover:bg-elevated hover:text-foreground"
                    >
                      清空全部
                    </button>
                  )}
                </div>

                <div className="mt-3 max-h-72 overflow-auto rounded-card border border-border bg-surface/60">
                  {filteredPickerGroups.length > 0 ? filteredPickerGroups.map(group => {
                    const active = pickerCustomGroupSet.has(group.id)
                    return (
                      <label
                        key={group.id}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 text-left text-sm last:border-b-0 transition-colors ${
                          active ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-elevated/70'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => togglePickerGroup(group.id)}
                            disabled={setSymbolGroups.isPending}
                            className="h-3.5 w-3.5 shrink-0 accent-accent"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{group.name}</span>
                            <span className="mt-0.5 block font-mono text-[11px] text-muted">{group.count} 只</span>
                          </span>
                        </span>
                        {active ? <Check className="h-4 w-4 shrink-0" /> : <Tags className="h-3.5 w-3.5 shrink-0 text-muted" />}
                      </label>
                    )
                  }) : (
                    <div className="px-3 py-4 text-sm text-muted">没有匹配的自定义分组</div>
                  )}
                </div>

                {canCreatePickerGroup && (
                  <button
                    type="button"
                    onClick={async () => {
                      const name = groupPickerQuery.trim()
                      if (!name) return
                      const res = await createGroupFromPicker.mutateAsync(name)
                      setSymbolCustomGroups(groupPicker.symbol, [...pickerCustomGroupIds, res.group.id])
                      setGroupPickerQuery('')
                    }}
                    disabled={createGroupFromPicker.isPending || setSymbolGroups.isPending}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-btn border border-accent/35 bg-accent/10 text-sm font-medium text-accent hover:bg-accent/15 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    新建「{groupPickerQuery.trim()}」并加入
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 清空确认弹窗 */}
      <AnimatePresence>
        {confirmClear && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setConfirmClear(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-[90vw] max-w-[380px] rounded-card border border-border bg-base shadow-2xl p-6"
            >
              <h3 className="text-sm font-medium text-foreground mb-2">确认清空观察池</h3>
              <p className="text-xs text-secondary mb-5">
                将移除全部 {allSymbols.length} 只观察标的，此操作不可恢复。
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 rounded-btn bg-elevated text-secondary hover:bg-elevated/80 text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => clearAll.mutate()}
                  disabled={clearAll.isPending}
                  className="px-3 py-1.5 rounded-btn bg-danger/15 text-danger hover:bg-danger/25 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {clearAll.isPending ? '清除中...' : '确认清空'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 列自定义侧栏 */}
      <ColumnCustomizer
        columns={columns}
        onChange={handleColumnsChange}
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
      />

      <StockPreviewDialog
        symbol={previewSymbol}
        name={previewName}
        onClose={closePreview}
      />
    </div>
  )
}
