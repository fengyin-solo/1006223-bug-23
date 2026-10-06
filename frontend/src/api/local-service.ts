import { MODULE_BY_KEY } from '@/data/modules'
import {
  businessDateField,
  businessNumberField,
  findByBusinessNumber,
  MISSING,
  parseDateValue,
  parseNumeric,
  statusField,
  todayLocal,
} from '@/data/normalize'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ListQuery,
  ModuleMeta,
  OverviewResult,
  PageResult,
  QueryResult,
  SaveResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

/** 每页条数：全模块统一，翻页状态由 list-state store 记住。 */
export const PAGE_SIZE = 8

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

/** 岗位权限：只有归属岗位能改动本模块，其余岗位（含值班管理员）只读。 */
export function canModify(key: string, post: string): boolean {
  return moduleMeta(key).ownerPost === post
}

function guardPost(meta: ModuleMeta, post: string): ActionResult | null {
  if (canModify(meta.key, post)) {
    return null
  }
  return {
    ok: false,
    message: `当前岗位「${post}」无权改动${meta.name}，仅归属岗位「${meta.ownerPost}」可操作，其余岗位只读`,
  }
}

/** 默认查询：按业务日期（操作时间等）新的在前；没有日期字段就按业务编号排。 */
export function defaultQuery(key: string): ListQuery {
  const meta = moduleMeta(key)
  const dateField = businessDateField(meta)
  return {
    filters: {},
    sortField: dateField ?? meta.fields[0],
    sortOrder: dateField ? 'desc' : 'asc',
    page: 1,
    size: PAGE_SIZE,
  }
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

/** 排先后：中文按拼音、数字按数值（GATE-0002 排在 GATE-0010 前），并列时按 id 兜底。 */
export function sortRows(rows: EntryRow[], sortField: string, sortOrder: 'asc' | 'desc'): EntryRow[] {
  if (!sortField) {
    return rows
  }
  const direction = sortOrder === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const byField = String(a[sortField] ?? '').localeCompare(String(b[sortField] ?? ''), 'zh-Hans-CN', {
      numeric: true,
    })
    if (byField !== 0) {
      return byField * direction
    }
    return Number(a.id) - Number(b.id)
  })
}

/** 收窄 + 排先后：列表、翻页、另存共用这一条管道，保证看到的就是同一份。 */
function matchedRows(key: string, query: ListQuery): EntryRow[] {
  return sortRows(filterRows(listRows(key), query.filters), query.sortField, query.sortOrder)
}

export function listEntries(key: string, query: ListQuery = defaultQuery(key)): PageResult {
  const matched = matchedRows(key, query)
  const size = Math.max(1, query.size)
  const pages = Math.max(1, Math.ceil(matched.length / size))
  // 收窄条件后页码可能越界：收回到最后一页，而不是显示空页。
  const page = Math.min(Math.max(1, query.page), pages)
  const items = matched.slice((page - 1) * size, page * size)
  return { items, total: matched.length, page, size, pages }
}

function sumNumeric(rows: EntryRow[], field: string): number {
  return rows.reduce((sum, row) => sum + (parseNumeric(row[field]) ?? 0), 0)
}

function maxNumeric(rows: EntryRow[], field: string): number {
  const values = rows.map((row) => parseNumeric(row[field])).filter((v): v is number => v !== null)
  return values.length ? Math.max(...values) : 0
}

function avgNumeric(rows: EntryRow[], field: string): number {
  const values = rows.map((row) => parseNumeric(row[field])).filter((v): v is number => v !== null)
  if (!values.length) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}

function withinDays(value: unknown, days: number): boolean {
  const time = parseDateValue(value)
  if (time === null) return false
  const diff = time - Date.now()
  return diff >= 0 && diff <= days * 24 * 3600 * 1000
}

/** 指标卡取值：与动作同名看动作目标状态，含状态名数状态，「总X」求和、「最大/平均X」聚合、「即将到期」看 30 天内。 */
function metricValue(meta: ModuleMeta, rows: EntryRow[], metric: string): number {
  const target = meta.actionTargets[metric]
  if (target) {
    return rows.filter((row) => row.status === target).length
  }
  for (const status of meta.statuses) {
    if (metric.includes(status)) {
      return rows.filter((row) => row.status === status).length
    }
  }
  for (const status of meta.statuses) {
    const core = status.replace(/[中内]$/, '')
    if (core.length >= 2 && metric.includes(core)) {
      return rows.filter((row) => row.status === status).length
    }
  }
  if (metric.startsWith('总')) {
    const field = metric.slice(1)
    if (meta.fields.includes(field)) {
      return sumNumeric(rows, field)
    }
  }
  if (metric.startsWith('最大')) {
    const field = meta.fields.find((item) => item.includes(metric.slice(2)))
    if (field) {
      return maxNumeric(rows, field)
    }
  }
  if (metric.startsWith('平均')) {
    const field = meta.fields.find((item) => item.includes(metric.slice(2)))
    if (field) {
      return avgNumeric(rows, field)
    }
  }
  if (metric.includes('即将到期')) {
    const field = meta.fields.find((item) => /有效期|下次|到期/.test(item))
    if (field) {
      return rows.filter((row) => withinDays(row[field], 30)).length
    }
  }
  return 0
}

/** 列表页一次取齐：当前页、总条数、跨页状态分布与指标卡，全部按同一份条件算。 */
export function queryEntries(key: string, query: ListQuery = defaultQuery(key)): QueryResult {
  const meta = moduleMeta(key)
  const page = listEntries(key, query)
  const matched = matchedRows(key, query)
  const statusCounts: Record<string, number> = {}
  for (const status of meta.statuses) {
    statusCounts[status] = matched.filter((row) => String(row.status) === status).length
  }
  const metrics = meta.metrics.map((label) => ({ label, value: metricValue(meta, matched, label) }))
  return { ...page, statusCounts, metrics }
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

export function runAction(key: string, id: number, action: string, post: string): ActionResult {
  const meta = moduleMeta(key)
  const denied = guardPost(meta, post)
  if (denied) {
    return denied
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 台账与状态同步：镜像字段跟着变，业务日期记为操作当天。
  const mirror = statusField(meta)
  if (mirror) {
    updated[mirror] = target
  }
  const dateField = businessDateField(meta)
  if (dateField) {
    updated[dateField] = todayLocal()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 登记/编辑。覆盖还是追加：选「覆盖」——同一业务编号只留一条，
 * 重复登记按最新提交覆盖原记录（留空的字段沿用原值），绝不出现两条；
 * 新编号才追加。存量回填（normalize）用的也是同一套口径，做法自洽。
 */
export function saveEntry(
  key: string,
  values: Record<string, string>,
  post: string,
  id?: number,
): SaveResult {
  const meta = moduleMeta(key)
  const denied = guardPost(meta, post)
  if (denied) {
    return denied
  }
  const numberField = businessNumberField(meta)
  const number = String(values[numberField] ?? '').trim()
  if (!number) {
    return { ok: false, message: `${numberField}不能为空` }
  }
  const rows = listRows(key)
  const cleaned: Record<string, string> = {}
  for (const field of meta.fields) {
    cleaned[field] = String(values[field] ?? '').trim()
  }

  if (id !== undefined) {
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const clash = rows.find(
      (row) => Number(row.id) !== id && String(row[numberField] ?? '').trim().toUpperCase() === number.toUpperCase(),
    )
    if (clash) {
      return { ok: false, message: `${numberField}「${number}」已登记在另一条的记录上，不能改成重复编号` }
    }
    const merged: EntryRow = { ...rows[index] }
    for (const field of meta.fields) {
      if (cleaned[field] !== '') {
        merged[field] = cleaned[field]
      }
    }
    merged[numberField] = number
    const next = [...rows]
    next[index] = merged
    saveRows(key, next)
    return { ok: true, id, message: `${meta.entity}「${number}」已更新` }
  }

  const existing = findByBusinessNumber(meta, rows, number)
  const status = existing ? String(existing.status) : meta.statuses[0]
  const row: EntryRow = existing
    ? { ...existing }
    : {
        id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
        status,
        pending: true,
        abnormal: false,
      }
  for (const field of meta.fields) {
    // 覆盖式登记：新提交的非空取值覆盖原值，留空的字段沿用原值，不拿空值去覆盖。
    if (cleaned[field] !== '' || !existing) {
      row[field] = cleaned[field]
    }
  }
  row[numberField] = number
  const dateField = businessDateField(meta)
  if (dateField && String(row[dateField] ?? '').trim() === '') {
    // 新登记没填业务日期：按登记当天回填；存量历史记录仍走「缺测」标注。
    row[dateField] = todayLocal()
  }
  const mirror = statusField(meta)
  if (mirror) {
    row[mirror] = status
  }
  const next = existing ? rows.map((item) => (Number(item.id) === row.id ? row : item)) : [...rows, row]
  saveRows(key, next)
  return existing
    ? { ok: true, id: Number(row.id), overwritten: true, message: `${meta.entity}「${number}」原本已登记，已按最新提交覆盖更新，不会出现两条` }
    : { ok: true, id: Number(row.id), overwritten: false, message: `${meta.entity}「${number}」已登记` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** 另存：与列表走同一份收窄与排先后，导出全部命中行，条数与页脚总数一致。 */
export function exportEntries(
  key: string,
  query: ListQuery = defaultQuery(key),
): { filename: string; content: string; count: number } {
  const meta = moduleMeta(key)
  const matched = matchedRows(key, query)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of matched) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? MISSING), row.status].map(csvCell).join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}`, count: matched.length }
}

export function downloadEntries(key: string, query: ListQuery = defaultQuery(key)): number {
  const { filename, content, count } = exportEntries(key, query)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return count
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      key: meta.key,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
