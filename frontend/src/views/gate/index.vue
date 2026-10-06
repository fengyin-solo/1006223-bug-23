<template>
  <section class="page" data-module="gate">
    <header class="page-head">
      <div>
        <h2>闸门启闭管理</h2>
        <p class="page-desc">维护闸门，围绕闸门编号、闸门类型、孔口尺寸、当前开度做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!writable" :title="writeHint" @click="openCreate">登记闸门</button>
        <button class="btn" type="button" :disabled="!writable" :title="writeHint" @click="backfill">回填历史记录</button>
        <button class="btn" type="button" @click="exportRows">另存闭门清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filterForm[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <label class="filter-item search-item">
        <span>全字段搜索</span>
        <input v-model="keyword" placeholder="搜编号 / 类型 / 人员，结果可直接定位" @focus="searching = true" @blur="closeSearch" />
      </label>
      <ul v-if="searching && searchResults.length" class="search-results">
        <li v-for="hit in searchResults" :key="String(hit.id)">
          <button type="button" class="link" @mousedown.prevent="locate(hit)">
            {{ hit['闸门编号'] }} · {{ hit['闸门类型'] }} · {{ hit['操作人员'] }}（{{ hit.status }}）
          </button>
        </li>
      </ul>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column" :class="{ sortable: sortableColumns.includes(column) }" @click="toggleSort(column)">
            {{ column }}
            <span v-if="sortField === column" class="sort-mark">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
          </th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column" :class="{ missing: row[column] === MISSING_VALUE }">
            <RouterLink v-if="column === '闸门编号'" class="link" :to="`/gate/${row.id}`">{{ row[column] }}</RouterLink>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!writable"
              :title="writeHint"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="`/gate/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">没有命中条件的闸门启闭记录，可调整条件或先登记闸门</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条闸门启闭记录（台账 {{ ledgerTotal }} 扇）</span>
      <span class="pagination">
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn ghost" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <select :value="size" @change="changeSize">
          <option v-for="option in sizeOptions" :key="option" :value="option">{{ option }} 条/页</option>
        </select>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-backdrop" @click.self="creating = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记闸门</h3>
        <label v-for="field in columns" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="field === '闸门编号' ? '必填，重复编号会被拒绝' : '留空则标注待补录'" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认登记</button>
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  MISSING_VALUE,
  backfillEntries,
  canWrite,
  computeSummary,
  createEntry,
  downloadEntries,
  moduleMeta,
  queryEntries,
  runAction as applyAction,
  searchEntries,
} from '@/api/local-service'
import { GATE_HISTORY } from '@/data/gate-history'
import type { EntryRow, ListQuery, StatItem } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('gate')
const columns = ["闸门编号", "闸门类型", "孔口尺寸", "当前开度", "启闭机型号", "操作人员", "操作时间", "闸门状态"]
const actions = ["开启闸门", "关闭闸门", "登记故障"]
const statuses = ["待操作", "运行中", "已关闭", "故障"]
const sortableColumns = ["闸门编号", "操作时间"]
const sizeOptions = [5, 10, 20]
const DEFAULT_SORT = "操作时间"

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(sizeOptions[0])
const sortField = ref(DEFAULT_SORT)
const sortDir = ref<'asc' | 'desc'>('desc')
const stats = ref<StatItem[]>([])
const ledgerTotal = ref(0)
const statusSummary = ref<{ status: string; count: number }[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const filterFields = columns.slice(0, 3)
const filterForm = reactive<Record<string, string>>({})
const keyword = ref('')
const searching = ref(false)
const creating = ref(false)
const createForm = reactive<Record<string, string>>({})
const createError = ref('')

const writable = computed(() => canWrite(meta.key, store.role))
const writeHint = computed(() => (writable.value ? '' : `归属${meta.ownerRole}，当前岗位只能查看`))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const searchResults = computed(() => searchEntries(meta.key, keyword.value))

// 查询状态只认 URL 这一份：点条件、往后翻、详情返回、另存读的都是它。
function readQuery(): ListQuery {
  const filters: Record<string, string> = {}
  for (const field of filterFields) {
    const value = route.query[`f_${field}`]
    if (typeof value === 'string' && value.trim() !== '') {
      filters[field] = value
    }
  }
  const dir = route.query.dir === 'asc' ? 'asc' : 'desc'
  const sort = typeof route.query.sort === 'string' ? route.query.sort : DEFAULT_SORT
  const pageNo = Number.parseInt(String(route.query.page ?? '1'), 10)
  const sizeNo = Number.parseInt(String(route.query.size ?? ''), 10)
  return {
    filters,
    sortField: sort,
    sortDir: dir,
    page: Number.isFinite(pageNo) && pageNo > 0 ? pageNo : 1,
    size: sizeOptions.includes(sizeNo) ? sizeNo : sizeOptions[0],
  }
}

function writeQuery(query: ListQuery) {
  const params: Record<string, string> = {}
  for (const [field, value] of Object.entries(query.filters ?? {})) {
    if (value.trim() !== '') {
      params[`f_${field}`] = value.trim()
    }
  }
  params.sort = query.sortField ?? DEFAULT_SORT
  params.dir = query.sortDir ?? 'desc'
  params.page = String(query.page ?? 1)
  params.size = String(query.size ?? sizeOptions[0])
  router.replace({ query: params })
}

function reload() {
  errorMessage.value = ''
  const query = readQuery()
  try {
    const payload = queryEntries(meta.key, query)
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    size.value = payload.size
    sortField.value = query.sortField ?? DEFAULT_SORT
    sortDir.value = query.sortDir ?? 'desc'
    for (const field of filterFields) {
      filterForm[field] = query.filters?.[field] ?? ''
    }
    const summary = computeSummary(meta.key)
    stats.value = summary.stats
    ledgerTotal.value = summary.total
    statusSummary.value = statuses.map((status) => ({ status, count: summary.statusCounts[status] ?? 0 }))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '闸门启闭列表读取失败'
  }
}

function applyFilters() {
  const filters: Record<string, string> = {}
  for (const field of filterFields) {
    if (filterForm[field]?.trim()) {
      filters[field] = filterForm[field]
    }
  }
  // 点条件回到第一页，但排序与每页条数保持当前选择
  writeQuery({ ...readQuery(), filters, page: 1 })
}

function resetFilters() {
  keyword.value = ''
  writeQuery({ ...readQuery(), filters: {}, page: 1 })
}

function goPage(target: number) {
  writeQuery({ ...readQuery(), page: target })
}

function changeSize(event: Event) {
  const next = Number((event.target as HTMLSelectElement).value)
  writeQuery({ ...readQuery(), size: next, page: 1 })
}

function toggleSort(column: string) {
  if (!sortableColumns.includes(column)) {
    return
  }
  const query = readQuery()
  if (query.sortField === column) {
    query.sortDir = query.sortDir === 'asc' ? 'desc' : 'asc'
  } else {
    query.sortField = column
    query.sortDir = column === DEFAULT_SORT ? 'desc' : 'asc'
  }
  query.page = 1
  writeQuery(query)
}

function exportRows() {
  // 另存与列表同一条收窄与排先条件，条数与页脚总数一致
  downloadEntries(meta.key, readQuery())
  noticeMessage.value = `已按当前条件另存 ${total.value} 条记录`
}

function openCreate() {
  createError.value = ''
  for (const field of columns) {
    createForm[field] = ''
  }
  creating.value = true
}

function submitCreate() {
  const result = createEntry(meta.key, { ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  noticeMessage.value = result.message
  reload()
}

function backfill() {
  noticeMessage.value = ''
  errorMessage.value = ''
  const result = backfillEntries(meta.key, GATE_HISTORY)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function locate(row: EntryRow) {
  searching.value = false
  keyword.value = ''
  router.push(`/gate/${row.id}`)
}

function closeSearch() {
  window.setTimeout(() => {
    searching.value = false
  }, 150)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

watch(() => route.query, reload, { immediate: true })
</script>
