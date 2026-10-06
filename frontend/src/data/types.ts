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
  /** 归属岗位：只有该岗位能改动本模块，其余岗位只读。 */
  ownerPost: string
}

/** 列表查询条件：收窄、排先后、翻页用的是同一份，另存也走它。 */
export type ListQuery = {
  filters: Record<string, string>
  sortField: string
  sortOrder: 'asc' | 'desc'
  page: number
  size: number
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  pages: number
}

export type QueryResult = PageResult & {
  /** 按当前条件收窄后的各状态条数（跨全部页，不只是当前页）。 */
  statusCounts: Record<string, number>
  metrics: { label: string; value: number }[]
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type SaveResult = ActionResult & {
  id?: number
  /** 覆盖式登记：命中同业务编号时为 true，表示更新了原记录而不是追加。 */
  overwritten?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; key: string; created: number; pending: number; abnormal: number }[]
}
