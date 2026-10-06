import { MODULE_BY_KEY } from './modules'
import { normalizeRows } from './normalize'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 读入时做存量规整（去重回填、缺测标注、实测优先），有变化就写回，迁移一次到位。 */
function normalizeAll(data: Record<string, EntryRow[]>): { data: Record<string, EntryRow[]>; changed: boolean } {
  let changed = false
  const next: Record<string, EntryRow[]> = { ...data }
  for (const meta of MODULE_BY_KEY.values()) {
    const rows = next[meta.key]
    if (!rows) continue
    const normalized = normalizeRows(meta, rows)
    if (JSON.stringify(normalized) !== JSON.stringify(rows)) {
      next[meta.key] = normalized
      changed = true
    }
  }
  return { data: next, changed }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = normalizeAll(clone(SEED_ROWS)).data
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const { data, changed } = normalizeAll(merged)
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    return data
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const meta = MODULE_BY_KEY.get(key)
  const next = { ...allRows(), [key]: meta ? normalizeRows(meta, rows) : rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  const rows = meta ? normalizeRows(meta, clone(SEED_ROWS[key] ?? [])) : clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
