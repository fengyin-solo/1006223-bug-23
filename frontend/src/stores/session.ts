import { defineStore } from 'pinia'

import { POSTS, type Post } from '@/data/modules'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
    /** 当前岗位：决定能改哪些模块；默认水工运行岗（闸门等水工模块的归属岗位）。 */
    post: '水工运行岗' as Post,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    availablePosts: () => [...POSTS],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setPost(post: Post) {
      this.post = post
    },
  },
})
