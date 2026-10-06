<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.entity }}详情</h2>
        <p class="page-desc">{{ meta.name }} · {{ numberField }}：{{ row?.[numberField] ?? '—' }}</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <template v-if="row">
      <p class="status-legend">
        <span class="legend-item">当前状态：{{ row.status }}</span>
        <span v-if="row.pending" class="legend-item">待处理</span>
        <span v-if="row.abnormal" class="legend-item abnormal">异常</span>
        <span v-if="!writable" class="legend-item readonly-tip">
          当前岗位「{{ session.post }}」只读，改动需归属岗位「{{ meta.ownerPost }}」
        </span>
      </p>

      <dl class="detail-grid">
        <div v-for="field in meta.fields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd :class="{ missing: row[field] === MISSING }">{{ row[field] ?? '—' }}</dd>
        </div>
      </dl>

      <div v-if="writable" class="detail-actions">
        <button
          v-for="action in meta.actions"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>

      <footer class="page-foot">
        <span>数据与本模块列表同源，改动后台账与另存明细同步更新</span>
        <span v-if="notice" class="notice-text">{{ notice }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <p class="empty-state">没有找到这条{{ meta.entity }}记录，可能已被合并或移除。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { canModify, getEntry, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { MISSING, businessNumberField } from '@/data/normalize'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ moduleKey: string; id: number }>()

const meta = moduleMeta(props.moduleKey)
const numberField = businessNumberField(meta)
const router = useRouter()
const session = useSessionStore()

const row = ref<EntryRow | undefined>(undefined)
const errorMessage = ref('')
const notice = ref('')

const writable = computed(() => canModify(meta.key, session.post))

function reload() {
  row.value = getEntry(meta.key, props.id)
}

function goBack() {
  // 列表状态（收窄、排先后、页码）在 list-state store 里，返回后停在原来那一页。
  router.push(`/${meta.key}`)
}

function runAction(action: string) {
  errorMessage.value = ''
  notice.value = ''
  const result = applyAction(meta.key, props.id, action, session.post)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

onMounted(reload)
</script>
