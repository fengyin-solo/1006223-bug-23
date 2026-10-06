<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button v-if="writable" class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="exportRows">另存{{ meta.name }}清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in metrics" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="status in meta.statuses" :key="status" class="legend-item">
        {{ status }}：{{ statusCounts[status] ?? 0 }}
      </span>
      <span v-if="!writable" class="legend-item readonly-tip">
        当前岗位「{{ session.post }}」只读，改动需归属岗位「{{ meta.ownerPost }}」
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="draft[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="column in meta.fields"
            :key="column"
            class="sortable"
            :class="{ active: state.sortField === column }"
            @click="toggleSort(column)"
          >
            {{ column }}
            <span v-if="state.sortField === column" class="sort-mark">{{ state.sortOrder === 'asc' ? '▲' : '▼' }}</span>
          </th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" class="clickable" @click="openDetail(row)">
          <td v-for="column in meta.fields" :key="column" :class="{ missing: row[column] === MISSING }">
            {{ row[column] ?? '—' }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions" @click.stop>
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <template v-if="writable">
              <button class="link" type="button" @click="openEdit(row)">编辑</button>
              <button
                v-for="action in meta.actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="readonly-text">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="meta.fields.length + 2" class="empty-state">
            当前条件下没有{{ meta.name }}记录，可调整条件或先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <nav v-if="pages > 1" class="pagination" aria-label="分页">
      <button class="btn ghost" type="button" :disabled="state.page <= 1" @click="goPage(state.page - 1)">上一页</button>
      <button
        v-for="item in pageItems"
        :key="item"
        class="btn page-num"
        :class="{ primary: item === state.page }"
        type="button"
        @click="goPage(item)"
      >
        {{ item }}
      </button>
      <button class="btn ghost" type="button" :disabled="state.page >= pages" @click="goPage(state.page + 1)">下一页</button>
    </nav>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.name }}记录 · 第 {{ state.page }} / {{ pages }} 页</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showForm" class="modal-mask" @click.self="closeForm">
      <form class="modal-card" @submit.prevent="submitForm">
        <h3>{{ editingId === null ? `登记${meta.entity}` : `编辑${meta.entity}` }}</h3>
        <p class="modal-tip">同一{{ numberField }}重复登记时按最新提交覆盖原记录，不会出现两条。</p>
        <label v-for="field in formFields" :key="field" class="form-item">
          <span>{{ field }}<em v-if="field === numberField" class="required">*</em></span>
          <input
            v-model="form[field]"
            :type="isDateField(field) ? 'date' : 'text'"
            :list="field === '闸门类型' ? 'gate-type-options' : undefined"
            :placeholder="field === numberField ? '必填，重复编号将覆盖原记录' : '留空则沿用原值，新记录标注缺测'"
          />
        </label>
        <datalist id="gate-type-options">
          <option value="弧形闸门" />
          <option value="平面闸门" />
          <option value="人字闸门" />
        </datalist>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存</button>
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  canModify,
  downloadEntries,
  moduleMeta,
  queryEntries,
  runAction as applyAction,
  saveEntry,
} from '@/api/local-service'
import { MISSING, businessNumberField, statusField } from '@/data/normalize'
import { useListStateStore } from '@/stores/list-state'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ moduleKey: string }>()

const meta = moduleMeta(props.moduleKey)
const router = useRouter()
const session = useSessionStore()
const listState = useListStateStore()
// 收窄条件、排先后、页码全模块各存一份：点条件、翻页、详情返回、另存读的都是它。
const state = listState.ensure(props.moduleKey)

const numberField = businessNumberField(meta)
const mirrorField = statusField(meta)
const formFields = meta.fields.filter((field) => field !== mirrorField)
const filterFields = meta.fields.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const pages = ref(1)
const statusCounts = ref<Record<string, number>>({})
const metrics = ref<{ label: string; value: number }[]>([])
const errorMessage = ref('')
const notice = ref('')

// 条件草稿：输入不立即生效，点「查询」才提交到共享状态；从详情返回时草稿回填共享状态。
const draft = reactive<Record<string, string>>({ ...state.filters })

const writable = computed(() => canModify(meta.key, session.post))

const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = reactive<Record<string, string>>({})
const formError = ref('')

const pageItems = computed(() => {
  const all = Array.from({ length: pages.value }, (_, i) => i + 1)
  if (all.length <= 9) return all
  const current = state.page
  const start = Math.min(Math.max(1, current - 4), all.length - 8)
  return all.slice(start - 1, start + 8)
})

function isDateField(field: string): boolean {
  return /时间|日期/.test(field)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = queryEntries(meta.key, state)
    rows.value = payload.items
    total.value = payload.total
    pages.value = payload.pages
    statusCounts.value = payload.statusCounts
    metrics.value = payload.metrics
    if (payload.page !== state.page) {
      // 收窄后页码越界被收回时，同步回共享状态，另存与返回看到的页码一致。
      listState.setPage(meta.key, payload.page)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
  }
}

function applyFilters() {
  notice.value = ''
  listState.applyFilters(meta.key, { ...draft })
  reload()
}

function resetFilters() {
  notice.value = ''
  listState.reset(meta.key)
  for (const field of Object.keys(draft)) delete draft[field]
  reload()
}

function toggleSort(field: string) {
  listState.toggleSort(meta.key, field)
  reload()
}

function goPage(page: number) {
  if (page < 1 || page > pages.value) return
  listState.setPage(meta.key, page)
  reload()
}

function openDetail(row: EntryRow) {
  router.push(`/${meta.key}/${row.id}`)
}

function exportRows() {
  // 另存与列表共用同一份收窄与排先后，导出条数与页脚总数一致。
  const count = downloadEntries(meta.key, state)
  errorMessage.value = ''
  notice.value = `已按当前条件另存 ${count} 条${meta.name}记录，与页脚总数一致`
}

function openCreate() {
  editingId.value = null
  formError.value = ''
  for (const field of formFields) form[field] = ''
  showForm.value = true
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  formError.value = ''
  for (const field of formFields) {
    const value = row[field]
    form[field] = value === undefined || value === MISSING ? '' : String(value)
  }
  showForm.value = true
}

function closeForm() {
  showForm.value = false
}

function submitForm() {
  formError.value = ''
  const result = saveEntry(meta.key, { ...form }, session.post, editingId.value ?? undefined)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showForm.value = false
  notice.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.post)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

onMounted(reload)
</script>
