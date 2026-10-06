import { defineStore } from 'pinia'

import { ALL_ROLES } from '@/data/modules'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
    // 当前岗位：决定能改动哪些模块，归属之外的岗位只能查看。
    role: '闸门操作岗',
    availableRoles: ALL_ROLES,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
    },
  },
})
