import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type {
  ActionResult,
  BackfillResult,
  EntryRow,
  ListQuery,
  ModuleMeta,
  ModuleSummary,
  OverviewResult,
  PageResult,
  StatItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

/** 缺失取值的统一标注：存量台账里补不上的字段一律填它，列表与导出同步显示。 */
export const MISSING_VALUE = '待补录'

/** 早期没有闸门类型的记录，对不上同尺寸参照时统一归这一类。 */
export const UNCLASSIFIED_GATE_TYPE = '未分类'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// ---------- 岗位权限：归属之外的岗位越权改动要拒绝，其余人只能查看不能改 ----------

export function canWrite(key: string, role: string): boolean {
  return moduleMeta(key).ownerRole === role
}

function currentRole(): string {
  try {
    return useSessionStore().role
  } catch {
    return ''
  }
}

/** 写操作统一入口校验：越权时返回拒绝结果，放行时返回 null。 */
function guardWrite(key: string): ActionResult | null {
  const meta = moduleMeta(key)
  const role = currentRole()
  if (!canWrite(key, role)) {
    return {
      ok: false,
      message: `「${meta.name}」归属${meta.ownerRole}，当前岗位「${role || '未设置'}」只能查看，不能改动`,
    }
  }
  return null
}

// ---------- 查询：筛选 + 排序 + 分页是一条整体，列表/翻页/详情返回/另存共用 ----------

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function sortRows(rows: EntryRow[], sortField?: string, sortDir: 'asc' | 'desc' = 'asc'): EntryRow[] {
  if (!sortField) {
    return rows
  }
  const sign = sortDir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const av = a[sortField]
    const bv = b[sortField]
    const an = Number.parseFloat(String(av))
    const bn = Number.parseFloat(String(bv))
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return (an - bn) * sign
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-Hans-CN') * sign
  })
}

/** 收窄 + 排先 + 分页：同一条查询条件进来，列表、翻页、详情返回看到的都是同一份结果。 */
export function queryEntries(key: string, query: ListQuery = {}): PageResult {
  const matched = sortRows(
    filterRows(listRows(key), query.filters ?? {}),
    query.sortField,
    query.sortDir,
  )
  const size = query.size && query.size > 0 ? query.size : Math.max(matched.length, 1)
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  return {
    items: matched.slice((page - 1) * size, page * size),
    total: matched.length,
    page,
    size,
  }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  return queryEntries(key, { filters })
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

/** 全字段检索：检索到的结果带 id，页面可直接定位到对应记录。 */
export function searchEntries(key: string, keyword: string, limit = 8): EntryRow[] {
  const meta = moduleMeta(key)
  const needle = keyword.trim().toLowerCase()
  if (!needle) {
    return []
  }
  const fields = [...meta.fields, 'status']
  return listRows(key)
    .filter((row) =>
      fields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle)),
    )
    .slice(0, limit)
}

// ---------- 登记与回填：按业务键去重，重复登记不会出现两条 ----------

function businessKey(meta: ModuleMeta): string {
  return meta.fields[0]
}

/** 业务日期字段：存量台账按它回填与排序（闸门模块即「操作时间」）。 */
function businessDateField(meta: ModuleMeta): string | undefined {
  return meta.fields.find((field) => field.endsWith('时间') || field.endsWith('日期'))
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function normalizeRecord(meta: ModuleMeta, record: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const field of meta.fields) {
    const value = String(record[field] ?? '').trim()
    normalized[field] = value === '' ? MISSING_VALUE : value
  }
  return normalized
}

/**
 * 闸门类型归类规则（裁决）：早期记录没有登记闸门类型时——
 * 1) 孔口尺寸与存量某扇已登记类型的闸门一致，沿用该类型（同尺寸同型）；
 * 2) 对不上的统一归「未分类」，在清单里单独标注，等业务确认后补录。
 */
function classifyGateType(
  record: Record<string, string>,
  existing: EntryRow[],
): { type: string; classified: boolean } {
  const size = String(record['孔口尺寸'] ?? '').trim()
  if (size) {
    const sibling = existing.find(
      (row) =>
        String(row['孔口尺寸'] ?? '') === size &&
        String(row['闸门类型'] ?? '') !== '' &&
        String(row['闸门类型']) !== MISSING_VALUE &&
        String(row['闸门类型']) !== UNCLASSIFIED_GATE_TYPE,
    )
    if (sibling) {
      return { type: String(sibling['闸门类型']), classified: true }
    }
  }
  return { type: UNCLASSIFIED_GATE_TYPE, classified: true }
}

export function createEntry(key: string, data: Record<string, string>): ActionResult {
  const denied = guardWrite(key)
  if (denied) {
    return denied
  }
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const idField = businessKey(meta)
  const idValue = String(data[idField] ?? '').trim()
  if (!idValue) {
    return { ok: false, message: `${idField}不能为空` }
  }
  if (rows.some((row) => String(row[idField]) === idValue)) {
    return { ok: false, message: `${meta.entity}「${idValue}」已登记，重复登记不会生成第二条` }
  }
  const record = normalizeRecord(meta, data)
  const entry: EntryRow = {
    ...record,
    id: nextId(rows),
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
  }
  saveRows(key, [...rows, entry])
  return { ok: true, message: `${meta.entity}「${idValue}」已登记，当前状态「${entry.status}」` }
}

/**
 * 历史记录回填。覆盖还是追加（裁决）：按业务键（闸门编号）归并——
 * 同编号时业务日期新的覆盖旧的（历史回填不会冲掉更新的台账），新编号直接追加；
 * 回填完成后全量按业务日期从新到旧排，缺失取值统一标注「待补录」。
 */
export function backfillEntries(key: string, records: Array<Record<string, string>>): BackfillResult {
  const denied = guardWrite(key)
  if (denied) {
    return { ...denied, covered: 0, appended: 0, keptNewer: 0, classified: 0 }
  }
  const meta = moduleMeta(key)
  const idField = businessKey(meta)
  const dateField = businessDateField(meta)
  const rows = [...listRows(key)]
  let covered = 0
  let appended = 0
  let keptNewer = 0
  let classified = 0

  for (const raw of records) {
    const idValue = String(raw[idField] ?? '').trim()
    if (!idValue) {
      continue
    }
    const record = normalizeRecord(meta, raw)
    if (key === 'gate' && record['闸门类型'] === MISSING_VALUE) {
      const result = classifyGateType(record, rows)
      record['闸门类型'] = result.type
      classified += 1
    }
    const index = rows.findIndex((row) => String(row[idField]) === idValue)
    if (index < 0) {
      rows.push({
        ...record,
        id: nextId(rows),
        status: meta.statuses[0],
        pending: true,
        abnormal: false,
      })
      appended += 1
      continue
    }
    const existing = rows[index]
    const incomingDate = dateField ? String(record[dateField] ?? '') : ''
    const existingDate = dateField ? String(existing[dateField] ?? '') : ''
    if (!dateField || incomingDate >= existingDate) {
      // 覆盖：回填值更新字段，id 与流转状态沿用现有记录
      rows[index] = { ...existing, ...record }
      covered += 1
    } else {
      keptNewer += 1
    }
  }

  if (dateField) {
    rows.sort((a, b) => String(b[dateField] ?? '').localeCompare(String(a[dateField] ?? '')))
  }
  saveRows(key, rows)
  return {
    ok: true,
    message: `回填完成：覆盖 ${covered} 条、追加 ${appended} 条、保留较新 ${keptNewer} 条、按规则归类 ${classified} 条`,
    covered,
    appended,
    keptNewer,
    classified,
  }
}

// ---------- 状态流转 ----------

// 动作副作用：关闭闸门时把实测开度归零，台账与现场一致。
const ACTION_EFFECTS: Record<string, (row: EntryRow) => Partial<EntryRow>> = {
  'gate:关闭闸门': () => ({ 当前开度: '0' }),
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const denied = guardWrite(key)
  if (denied) {
    return denied
  }
  const meta = moduleMeta(key)
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
    ...ACTION_EFFECTS[`${key}:${action}`]?.(rows[index]),
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---------- 台账汇总：统计卡与状态分布从全量数据算，跨模块读到的台数一致 ----------

/** 实测值解析：缺失（待补录/空/非数字）返回 null，由调用方退回限值或状态那一套。 */
export function measuredNumber(row: EntryRow, field: string): number | null {
  const raw = row[field]
  if (raw === undefined || raw === null) {
    return null
  }
  const text = String(raw).trim()
  if (text === '' || text === MISSING_VALUE) {
    return null
  }
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

// 实测值优先：当前开度有实测值时以实测为准（>0 记开启、=0 记关闭），
// 与状态字段冲突时统一取实测；实测缺失（待补录）才退回状态字段判断。
function gateStats(rows: EntryRow[]): StatItem[] {
  const isOpen = (row: EntryRow): boolean => {
    const measured = measuredNumber(row, '当前开度')
    return measured !== null ? measured > 0 : row.status === '运行中'
  }
  const isClosed = (row: EntryRow): boolean => {
    const measured = measuredNumber(row, '当前开度')
    return measured !== null ? measured === 0 : row.status === '已关闭'
  }
  return [
    { label: '开启闸门', value: rows.filter(isOpen).length },
    { label: '关闭闸门', value: rows.filter(isClosed).length },
    { label: '故障闸门', value: rows.filter((row) => row.status === '故障').length },
  ]
}

const SOON_DAYS = 30

function daysUntil(dateText: string): number | null {
  const time = Date.parse(dateText)
  if (Number.isNaN(time)) {
    return null
  }
  return Math.ceil((time - Date.now()) / 86400000)
}

function protectionStats(rows: EntryRow[]): StatItem[] {
  const dueSoon = rows.filter((row) => {
    if (row.status === '已退出') {
      return false
    }
    const days = daysUntil(String(row['下次校验日'] ?? ''))
    return days !== null && days >= 0 && days <= SOON_DAYS
  }).length
  return [
    { label: '正常保护装置', value: rows.filter((row) => row.status === '正常').length },
    { label: '待校验装置', value: rows.filter((row) => row.status === '待校验').length },
    { label: '即将到期装置', value: dueSoon },
  ]
}

const STAT_CALCULATORS: Record<string, (rows: EntryRow[]) => StatItem[]> = {
  gate: gateStats,
  protection: protectionStats,
}

export function computeSummary(key: string): ModuleSummary {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const statusCounts: Record<string, number> = {}
  for (const status of meta.statuses) {
    statusCounts[status] = rows.filter((row) => row.status === status).length
  }
  const stats = STAT_CALCULATORS[key]?.(rows) ?? meta.metrics.map((label) => ({ label, value: 0 }))
  return { stats, statusCounts, total: rows.length }
}

// ---------- 导出：与列表同一条查询条件，另存条数与页脚总数一致 ----------

function csvCell(value: string | number | boolean | undefined): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 另存走与列表同一套收窄与排先条件（全量命中行，不分页），台账与导出的明细同时更新。 */
export function exportEntries(key: string, query: ListQuery = {}): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const matched = sortRows(
    filterRows(listRows(key), query.filters ?? {}),
    query.sortField,
    query.sortDir,
  )
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of matched) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].map(csvCell).join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string, query: ListQuery = {}): void {
  const { filename, content } = exportEntries(key, query)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
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
