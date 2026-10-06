<template>
  <section class="page" data-module="protection">
    <header class="page-head">
      <div>
        <h2>继电保护管理</h2>
        <p class="page-desc">维护保护装置，围绕装置编号、保护类型、定值单号、上次校验日做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!writable" :title="writeHint" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="exportRows">导出继电保护清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column" :class="{ missing: row[column] === MISSING_VALUE }">{{ row[column] ?? '—' }}</td>
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
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无继电保护数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条继电保护记录（台账 {{ ledgerTotal }} 台）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  MISSING_VALUE,
  canWrite,
  computeSummary,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, StatItem } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('protection')
const columns = ["装置编号", "保护类型", "定值单号", "上次校验日", "下次校验日", "动作次数", "校验人员", "装置状态"]
const actions = ["提交校验", "标记异常", "退出运行"]
const statuses = ["待校验", "正常", "异常", "已退出"]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const ledgerTotal = ref(0)
const stats = ref<StatItem[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = ref<{ status: string; count: number }[]>([])

const writable = computed(() => canWrite(meta.key, store.role))
const writeHint = computed(() => (writable.value ? '' : `归属${meta.ownerRole}，当前岗位只能查看`))

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  // 导出与列表同一条收窄条件，台账与导出的明细同时更新
  downloadEntries(meta.key, { filters: filters.value })
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 统计与台数从全量台账算，运营概览跨模块读到的台数与这里一致
    const summary = computeSummary(meta.key)
    stats.value = summary.stats
    ledgerTotal.value = summary.total
    statusSummary.value = statuses.map((status) => ({ status, count: summary.statusCounts[status] ?? 0 }))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继电保护列表读取失败'
  }
}

onMounted(reload)
</script>
