/**
 * 冒烟脚本：直接打数据层，核对这次修复的关键行为。
 * 运行：npx esbuild scripts/smoke.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs
 */
import { createPinia, setActivePinia } from 'pinia'

import {
  canModify,
  defaultQuery,
  exportEntries,
  listEntries,
  loadOverview,
  queryEntries,
  runAction,
  saveEntry,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import { MISSING, normalizeRows } from '@/data/normalize'
import { useListStateStore } from '@/stores/list-state'

let failed = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

// ── 闸门：存量规整 ─────────────────────────────
const gates = listRows('gate')
check('闸门去重后总数（15 条种子含 1 条重复编号）', gates.length, 14)
check('重复编号 GATE-0007 只剩一条', gates.filter((r) => r['闸门编号'] === 'GATE-0007').length, 1)
const g7 = gates.find((r) => r['闸门编号'] === 'GATE-0007')!
check('GATE-0007 按操作时间保留最新一条', g7['操作时间'], '2026-09-22')
check('GATE-0007 缺失的操作人员从历史记录回填', g7['操作人员'], '王秀英')
const g11 = gates.find((r) => r['闸门编号'] === 'GATE-0011')!
check('早期无类型记录按启闭机型号推定（QH→弧形）', g11['闸门类型'], '弧形闸门（推定）')
const g13 = gates.find((r) => r['闸门编号'] === 'GATE-0013')!
check('型号也缺失时按默认规则归类', g13['闸门类型'], '平面闸门（推定）')
check('缺失取值单独标注', g13['孔口尺寸'], MISSING)
const g14 = gates.find((r) => r['闸门编号'] === 'GATE-0014')!
check('实测开度>0 与「已关闭」冲突时按实测取值', g14.status, '运行中')
check('状态镜像字段同步', g14['闸门状态'], '运行中')

// ── 闸门：收窄 / 排先后 / 翻页 / 另存同一条条件 ──
const query = defaultQuery('gate')
check('默认按操作时间新的在前', query.sortField, '操作时间')
const page1 = listEntries('gate', query)
check('第一页条数', page1.items.length, 8)
check('总条数与页数', [page1.total, page1.pages], [14, 2])
const page2 = listEntries('gate', { ...query, page: 2 })
check('第二页条数', page2.items.length, 6)
check('第二页第一条是第 9 新记录', page2.items[0]['闸门编号'], 'GATE-0009')

const narrowed = { ...query, filters: { 闸门类型: '弧形闸门' } }
const narrowedResult = queryEntries('gate', narrowed)
check('按闸门类型收窄后总数', narrowedResult.total, 7)
const exported = exportEntries('gate', narrowed)
check('另存条数与页脚总数一致', exported.count, narrowedResult.total)
check('另存内容行数（含表头）', exported.content.trim().split('\n').length, 8)
check('另存不含平面闸门', exported.content.includes('平面闸门'), false)
check('收窄后页码越界被收回', listEntries('gate', { ...narrowed, page: 2 }).page, 1)

const sortedAsc = listEntries('gate', { ...query, sortField: '闸门编号', sortOrder: 'asc', size: 100 })
check('编号升序第一条', sortedAsc.items[0]['闸门编号'], 'GATE-0001')
check('编号按数值排（0002 在 0010 前）',
  sortedAsc.items.findIndex((r) => r['闸门编号'] === 'GATE-0002') <
    sortedAsc.items.findIndex((r) => r['闸门编号'] === 'GATE-0010'),
  true)

// ── 闸门：覆盖式登记与权限 ──────────────────────
const denied = saveEntry('gate', { 闸门编号: 'GATE-0100' }, '电气检修岗')
check('归属之外岗位改动被拒绝', denied.ok, false)
const deniedAction = runAction('gate', 1, '开启闸门', '值班管理员')
check('值班管理员越权操作被拒绝', deniedAction.ok, false)
check('水工运行岗可改闸门', canModify('gate', '水工运行岗'), true)
check('水工运行岗不可改继电保护', canModify('protection', '水工运行岗'), false)

const created = saveEntry('gate', { 闸门编号: 'GATE-0100', 闸门类型: '平面闸门' }, '水工运行岗')
check('新编号登记成功', created.ok, true)
check('新登记业务日期回填为当天', listRows('gate').find((r) => r['闸门编号'] === 'GATE-0100')!['操作时间'], '2026-10-06')
const dup = saveEntry('gate', { 闸门编号: 'gate-0100', 当前开度: '1.0m' }, '水工运行岗')
check('重复登记走覆盖不追加', [dup.ok, dup.overwritten], [true, true])
check('覆盖后总数仍 15', listRows('gate').length, 15)
const g100 = listRows('gate').find((r) => r['闸门编号'] === 'gate-0100')!
check('覆盖时新值生效', g100['当前开度'], '1.0m')
check('覆盖时留空字段沿用原值', g100['闸门类型'], '平面闸门')

const acted = runAction('gate', Number(g100.id), '开启闸门', '水工运行岗')
check('归属岗位操作成功', acted.ok, true)
const g100After = listRows('gate').find((r) => Number(r.id) === Number(g100.id))!
check('操作后状态与镜像字段同步', [g100After.status, g100After['闸门状态']], ['运行中', '运行中'])
check('操作时间记为当天', g100After['操作时间'], '2026-10-06')

// ── 继电保护：跨模块台数一致 ────────────────────
const overview = loadOverview()
const protectionOverview = overview.modules.find((m) => m.key === 'protection')!
const protectionList = listEntries('protection', defaultQuery('protection'))
check('概览与列表读到的保护装置台数相同', protectionOverview.created, protectionList.total)
check('保护台账按上次校验日新的在前', protectionList.items[0]['装置编号'], 'PROT-0005')
check('缺失校验人员单独标注', protectionList.items[0]['校验人员'], MISSING)
const protectionSummary = queryEntries('protection', defaultQuery('protection'))
check('即将到期装置（30 天内）', protectionSummary.metrics.find((m) => m.label === '即将到期装置')!.value, 1)
const protectionExport = exportEntries('protection', defaultQuery('protection'))
check('保护台账另存条数与总数一致', protectionExport.count, protectionList.total)

// ── 列表状态：点条件 / 翻页 / 详情返回 / 另存共用同一条 ──
setActivePinia(createPinia())
const listState = useListStateStore()
const kept = listState.ensure('gate')
listState.applyFilters('gate', { 闸门类型: '弧形闸门' })
listState.setPage('gate', 2)
// 模拟离开列表去详情页再返回：状态还在，页码不被默认值重建。
const backAgain = listState.ensure('gate')
check('详情返回后条件仍在', backAgain.filters, { 闸门类型: '弧形闸门' })
check('详情返回后停在原页码', backAgain.page, 2)
check('同一模块拿到的是同一份状态', backAgain === kept, true)
const footerTotal = queryEntries('gate', backAgain).total
check('另存与页脚按同一份状态出数', exportEntries('gate', backAgain).count, footerTotal)
const summary = queryEntries('gate', backAgain)
check('状态图例跨页统计（总数=各状态之和）',
  Object.values(summary.statusCounts).reduce((a, b) => a + b, 0),
  summary.total)
listState.applyFilters('gate', { 闸门类型: '平面闸门' })
check('改条件后页码回到第一页', listState.ensure('gate').page, 1)
listState.reset('gate')
check('重置后条件清空', listState.ensure('gate').filters, {})

// ── 规整幂等与登记边界 ─────────────────────────
const gateMeta = MODULE_BY_KEY.get('gate')!
const once = normalizeRows(gateMeta, listRows('gate'))
check('存量规整幂等（再跑一遍结果不变）', normalizeRows(gateMeta, once), once)
const emptyNumber = saveEntry('gate', { 闸门编号: '  ' }, '水工运行岗')
check('业务编号为空拒绝登记', emptyNumber.ok, false)
const editClash = saveEntry('gate', { 闸门编号: 'GATE-0002' }, '水工运行岗', Number(g100.id))
check('编辑改成别人已有的编号被拒绝', editClash.ok, false)
const editOk = saveEntry('gate', { 闸门编号: 'GATE-0100', 操作人员: '刘志强' }, '水工运行岗', Number(g100.id))
check('正常编辑成功', editOk.ok, true)
check('编辑后编号不重复', listRows('gate').filter((r) => String(r['闸门编号']).toUpperCase() === 'GATE-0100').length, 1)

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)