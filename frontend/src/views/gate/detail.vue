<template>
  <section class="page" data-module="gate">
    <header class="page-head">
      <div>
        <h2>闸门详情 {{ entry ? `· ${entry['闸门编号']}` : '' }}</h2>
        <p class="page-desc">单扇闸门的完整台账与状态流转，返回列表时停在原来的页码与条件。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <template v-if="entry">
      <table class="data-table detail-table">
        <tbody>
          <tr v-for="column in columns" :key="column">
            <th>{{ column }}</th>
            <td :class="{ missing: entry[column] === MISSING_VALUE }">{{ entry[column] ?? '—' }}</td>
          </tr>
          <tr>
            <th>当前状态</th>
            <td>{{ entry.status }}</td>
          </tr>
        </tbody>
      </table>

      <div class="detail-actions">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          type="button"
          :disabled="!writable"
          :title="writeHint"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>
    </template>

    <p v-else class="empty-state">没有找到这扇闸门，可能已被移除，请返回列表重新选择。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { MISSING_VALUE, canWrite, getEntry, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('gate')
const columns = ["闸门编号", "闸门类型", "孔口尺寸", "当前开度", "启闭机型号", "操作人员", "操作时间", "闸门状态"]
const actions = ["开启闸门", "关闭闸门", "登记故障"]

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const entry = ref<EntryRow>()
const errorMessage = ref('')
const noticeMessage = ref('')

const writable = computed(() => canWrite(meta.key, store.role))
const writeHint = computed(() => (writable.value ? '' : `归属${meta.ownerRole}，当前岗位只能查看`))

function load() {
  entry.value = getEntry(meta.key, Number(route.params.id))
}

function goBack() {
  // 列表的收窄、排先、页码都在 URL 里，回退即恢复原样
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push('/gate')
  }
}

function runAction(action: string) {
  if (!entry.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(entry.value.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  load()
}

watch(() => route.params.id, load, { immediate: true })
</script>
