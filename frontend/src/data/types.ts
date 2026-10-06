/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 归属岗位：只有该岗位能改动本模块，其余岗位只能查看。 */
  ownerRole: string
}

/** 列表查询条件：筛选、排序、页码是一条整体，列表/翻页/详情返回/另存共用。 */
export type ListQuery = {
  filters?: Record<string, string>
  sortField?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  size?: number
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type StatItem = {
  label: string
  value: number
}

/** 模块台账汇总：统计卡、状态分布、全量台数，跨模块读到的台数以这里为准。 */
export type ModuleSummary = {
  stats: StatItem[]
  statusCounts: Record<string, number>
  total: number
}

/** 历史回填结果：同编号按操作时间覆盖或保留，新编号追加。 */
export type BackfillResult = ActionResult & {
  covered: number
  appended: number
  keptNewer: number
  classified: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
