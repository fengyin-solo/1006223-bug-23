import { defineStore } from 'pinia'

import { defaultQuery } from '@/api/local-service'
import type { ListQuery } from '@/data/types'

/**
 * 每个模块的列表状态（收窄条件、排先后、页码）只在这里存一份：
 * 点条件、往后翻、从详情页返回、另存，读的都是同一条，页面不再各自重建默认值。
 * 放在 pinia 里，路由来回切换不丢；刷新页面才回到默认。
 */
export const useListStateStore = defineStore('list-state', {
  state: () => ({
    byModule: {} as Record<string, ListQuery>,
  }),
  actions: {
    /** 取模块的列表状态，没有就按模块默认值（业务日期新的在前）建一份。 */
    ensure(key: string): ListQuery {
      if (!this.byModule[key]) {
        this.byModule[key] = defaultQuery(key)
      }
      return this.byModule[key]
    },
    /** 提交收窄条件：条件换了，页码回到第一页。 */
    applyFilters(key: string, filters: Record<string, string>) {
      const state = this.ensure(key)
      state.filters = Object.fromEntries(
        Object.entries(filters)
          .map(([field, value]) => [field, value.trim()])
          .filter(([, value]) => value !== ''),
      )
      state.page = 1
    },
    /** 点列表头排先后：再点同一列就倒过来。 */
    toggleSort(key: string, field: string) {
      const state = this.ensure(key)
      if (state.sortField === field) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
      } else {
        state.sortField = field
        state.sortOrder = 'asc'
      }
    },
    setPage(key: string, page: number) {
      this.ensure(key).page = page
    },
    reset(key: string) {
      this.byModule[key] = defaultQuery(key)
    },
  },
})
