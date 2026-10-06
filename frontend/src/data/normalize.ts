import type { EntryRow, ModuleMeta } from './types'

/**
 * 存量数据规整：读取台账时统一过一遍，保证列表页、详情页、概览、另存看到的是同一份结论。
 * 规则都是幂等的，重复执行结果不变：
 * 1. 同一业务编号只留一条：按业务日期（操作时间等）最新者为准，缺失字段用旧记录回填；
 * 2. 早期没有闸门类型的记录按启闭机型号推定归类，并标注「（推定）」；
 * 3. 仍缺失的取值单独标注为「缺测」，不留空、不编造；
 * 4. 实测值优先：实测（开度/渗流量/位移）与台账结论冲突时，按实测那一套统一取值；
 * 5. 「X状态」字段与当前状态对齐，台账与导出明细同步。
 */

/** 缺失取值的统一标注。 */
export const MISSING = '缺测'

/** 推定取值的标注后缀。 */
export const INFERRED_MARK = '（推定）'

/** 业务编号字段：各模块的第一个字段（闸门编号、装置编号……），去重与覆盖式登记都认它。 */
export function businessNumberField(meta: ModuleMeta): string {
  return meta.fields[0]
}

/** 业务日期字段：字段名里带「时间/日期」或以「日/有效期」结尾的第一个字段（操作时间、监测日期、上次校验日、证书有效期……）。 */
export function businessDateField(meta: ModuleMeta): string | undefined {
  return meta.fields.find((field) => /时间|日期|日$|有效期$/.test(field))
}

/** 状态镜像字段：排在最后、以「状态」结尾的字段，内容始终与当前状态一致。 */
export function statusField(meta: ModuleMeta): string | undefined {
  const last = meta.fields[meta.fields.length - 1]
  return last && last.endsWith('状态') ? last : undefined
}

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

/** 从「2.5m」「约 12 ℃」这类取值里抽出第一个数；抽不出来返回 null。 */
export function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

/** 解析业务日期（支持「2026-09-01」「2026-09-01 14:30」），解析不了返回 null。 */
export function parseDateValue(value: unknown): number | null {
  if (isMissing(value)) return null
  const text = String(value).trim()
  const match = text.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
  if (!match) return null
  const time = Date.parse(text.replace(/\//g, '-'))
  if (!Number.isNaN(time)) return time
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(day.getTime()) ? null : day.getTime()
}

/** 本机今天，YYYY-MM-DD。 */
export function todayLocal(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function sameBusinessNumber(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()
}

/**
 * 早期记录没有闸门类型时的归类规则（裁决）：
 * 启闭机型号含「人字」→ 人字闸门；含「弧」或以 QH 开头、或含「液压」→ 弧形闸门；
 * 含「螺杆/卷扬」或以 QL/QP 开头 → 平面闸门；型号也缺失时一律按平面闸门归类。
 * 推定结果带「（推定）」后缀，与人工登记的取值区分开。
 */
function inferGateType(row: EntryRow): string {
  const hoist = String(row['启闭机型号'] ?? '').trim().toUpperCase()
  let type = '平面闸门'
  if (hoist.includes('人字')) {
    type = '人字闸门'
  } else if (hoist.includes('弧') || hoist.startsWith('QH') || hoist.includes('液压')) {
    type = '弧形闸门'
  } else if (hoist.includes('螺杆') || hoist.includes('卷扬') || hoist.startsWith('QL') || hoist.startsWith('QP')) {
    type = '平面闸门'
  }
  return `${type}${INFERRED_MARK}`
}

/** 实测值优先：实测与台账结论冲突时，按实测统一取值。只处理能解析出数值的记录。 */
function applyMeasuredPriority(meta: ModuleMeta, row: EntryRow): EntryRow {
  const next = { ...row }
  if (meta.key === 'gate') {
    const opening = parseNumeric(row['当前开度'])
    if (opening !== null && !isMissing(row['当前开度'])) {
      // 已关闭但实测开度大于 0 → 以实测为准，视为运行中；运行中但实测开度为 0 → 视为已关闭。
      if (next.status === '已关闭' && opening > 0) next.status = '运行中'
      else if (next.status === '运行中' && opening === 0) next.status = '已关闭'
    }
  }
  if (meta.key === 'seepage') {
    const flow = parseNumeric(row['渗流量'])
    const limit = parseNumeric(row['警戒数值'])
    if (flow !== null && limit !== null && flow > limit && next.status === '正常') {
      next.status = '预警'
    }
  }
  if (meta.key === 'displacement') {
    const total = parseNumeric(row['累计位移'])
    const limit = parseNumeric(row['允许位移'])
    if (total !== null && limit !== null && total > limit && (next.status === '待观测' || next.status === '观测中')) {
      next.status = '超限'
    }
  }
  return next
}

function normalizeOne(meta: ModuleMeta, row: EntryRow): EntryRow {
  let next = applyMeasuredPriority(meta, row)
  // 闸门类型缺失 → 按规则推定归类
  if (meta.fields.includes('闸门类型') && isMissing(next['闸门类型'])) {
    next = { ...next, 闸门类型: inferGateType(next) }
  }
  // 其余缺失取值单独标注
  for (const field of meta.fields) {
    if (isMissing(next[field])) {
      next = { ...next, [field]: MISSING }
    }
  }
  // 状态镜像字段与当前状态对齐
  const mirror = statusField(meta)
  if (mirror && next[mirror] !== next.status) {
    next = { ...next, [mirror]: next.status }
  }
  return next
}

/**
 * 同一业务编号只留一条：按业务日期最新者为准（历史记录按操作时间回填），
 * 新记录缺的字段用旧记录补齐；编号缺失的记录不参与合并，各自保留。
 */
function dedupeByBusinessNumber(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  const numberField = businessNumberField(meta)
  const dateField = businessDateField(meta)
  const kept: EntryRow[] = []
  const indexByNumber = new Map<string, number>()
  rows.forEach((row) => {
    const number = row[numberField]
    const key = isMissing(number) || number === MISSING ? '' : String(number).trim().toUpperCase()
    const existingIndex = key ? indexByNumber.get(key) : undefined
    if (existingIndex === undefined) {
      if (key) indexByNumber.set(key, kept.length)
      kept.push(row)
      return
    }
    const current = kept[existingIndex]
    const currentDate = dateField ? parseDateValue(current[dateField]) : null
    const incomingDate = dateField ? parseDateValue(row[dateField]) : null
    // 业务日期新的为准；都缺日期时以先登记的为准，不互相覆盖。
    const incomingWins = incomingDate !== null && (currentDate === null || incomingDate >= currentDate)
    const base = incomingWins ? row : current
    const fallback = incomingWins ? current : row
    const merged: EntryRow = { ...base }
    for (const field of meta.fields) {
      if (isMissing(merged[field]) && !isMissing(fallback[field])) {
        merged[field] = fallback[field]
      }
    }
    merged.abnormal = Boolean(current.abnormal) || Boolean(row.abnormal)
    merged.pending = Boolean(base.pending)
    kept[existingIndex] = merged
  })
  return kept
}

/** 规整一个模块的全部记录：先去重回填，再逐条标注与纠偏。 */
export function normalizeRows(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  return dedupeByBusinessNumber(meta, rows).map((row) => normalizeOne(meta, row))
}

/** 覆盖式登记用的查重：台账里是否已有同业务编号的记录。 */
export function findByBusinessNumber(
  meta: ModuleMeta,
  rows: EntryRow[],
  number: string,
): EntryRow | undefined {
  const field = businessNumberField(meta)
  return rows.find((row) => !isMissing(row[field]) && sameBusinessNumber(row[field], number))
}
