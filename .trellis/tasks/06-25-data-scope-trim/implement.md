# 数据减脂与按需同步 - Implementation Plan

## Checklist

1. Backend focus universe
   - Add or reuse a resolver that returns watchlist + recent alert symbols +
     demo fallback.
   - Stop default pipeline from calling `CN_Equity_A` first.
   - Preserve a full-market path for explicit/manual calls.

2. AkShare daily sync
   - Add optional `symbols` / `full_market` control.
   - Default to focus symbols.
   - Keep old all-instruments traversal for advanced manual mode.

3. Data page copy
   - Rename default sync language from full-market/full-pipeline to focus scope.
   - Mark index/minute/financial/full rebuild tasks as manual/heavy where shown.

4. Indicator defaults
   - Inspect watchlist and screener column default configs.
   - Hide noisy raw indicators by default.
   - Keep columns available in customizer.

5. Validation
   - Backend: run a syntax/static check for touched Python files.
   - Frontend: run `pnpm exec tsc -b`.
   - Record any sandbox/tooling blocker.

## Risk Points

- Existing users with custom columns should not lose their saved configs.
- Strategy pages may expect all-market enriched data for scan counts; Phase 1
  should make heavy scans explicit rather than silently impossible.
- First-run state must still produce a non-empty focus universe via fallback
  demo symbols.

## Validation Results

- `pnpm exec tsc -b` (frontend): passed.
- `git diff --check`: passed; Git reported CRLF normalization warnings only.
- `python -c "... ast.parse(...)"` for touched backend Python files: passed.
- `python -m compileall ...`: attempted but blocked by existing `__pycache__`
  write permissions (`WinError 5`), so AST parsing was used for syntax
  validation without writing `.pyc` files.
