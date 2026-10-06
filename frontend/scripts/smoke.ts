/* 数据层冒烟测试：验证查询一致性、导出同口径、去重、回填、权限、实测优先。 */
import { createPinia, setActivePinia } from 'pinia'

setActivePinia(createPinia())

const service = await import('@/api/local-service')
const store_ = await import('@/data/local-store')
service.listRows = store_.listRows
const { useSessionStore } = await import('@/stores/session')
const { GATE_HISTORY } = await import('@/data/gate-history')

const store = useSessionStore()
let failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
}

// 1. 收窄 + 翻页：同一条件翻页后总数不变
const q = { filters: { '闸门类型': '弧形闸门' }, sortField: '操作时间', sortDir: 'desc' as const, size: 2 }
const p1 = service.queryEntries('gate', { ...q, page: 1 })
const p2 = service.queryEntries('gate', { ...q, page: 2 })
check('收窄后第一页条数', p1.items.length, 2)
check('收窄后第二页条数', p2.items.length, 2)
check('翻页后总数不变', p2.total, p1.total)

// 2. 另存与页脚同口径
const csv = service.exportEntries('gate', q)
check('另存条数与页脚总数一致', csv.content.trim().split('\n').length - 1, p1.total)

// 3. 越权拒绝（当前岗位闸门操作岗，继电保护归属保护校验岗）
const denied = service.runAction('protection', 1, '提交校验')
check('归属之外岗位改动被拒绝', denied.ok, false)

// 4. 登记去重
const dup = service.createEntry('gate', { '闸门编号': 'GATE-0001' })
check('重复登记被拒绝', dup.ok, false)
const created = service.createEntry('gate', { '闸门编号': 'GATE-0200', '闸门类型': '平面闸门' })
check('新编号登记成功', created.ok, true)
const again = service.createEntry('gate', { '闸门编号': 'GATE-0200' })
check('同一编号不会登记两条', again.ok, false)
check('登记后只有一条 GATE-0200', service.listRows('gate').filter((r) => r['闸门编号'] === 'GATE-0200').length, 1)
check('登记缺省字段标注待补录', service.listRows('gate').find((r) => r['闸门编号'] === 'GATE-0200')?.['孔口尺寸'], '待补录')

// 5. 历史回填：覆盖/追加/保留较新/归类
const bf = service.backfillEntries('gate', GATE_HISTORY)
check('回填-覆盖', bf.covered, 1)
check('回填-追加', bf.appended, 4)
check('回填-保留较新', bf.keptNewer, 1)
check('回填-归类', bf.classified, 2)
const rows = service.listRows('gate')
const g3 = rows.find((r) => r['闸门编号'] === 'GATE-0003')
check('较新回填覆盖旧台账', g3?.['当前开度'], '1.1')
const g2 = rows.find((r) => r['闸门编号'] === 'GATE-0002')
check('较旧回填不冲掉新台账', g2?.['操作时间'], '2026-09-27')
const g102 = rows.find((r) => r['闸门编号'] === 'GATE-0102')
check('同尺寸沿用类型', g102?.['闸门类型'], '弧形闸门')
const g103 = rows.find((r) => r['闸门编号'] === 'GATE-0103')
check('无参照归未分类', g103?.['闸门类型'], '未分类')
check('缺失开度标注待补录', g103?.['当前开度'], '待补录')
const g104 = rows.find((r) => r['闸门编号'] === 'GATE-0104')
check('缺失人员标注待补录', g104?.['操作人员'], '待补录')
const dates = rows.map((r) => String(r['操作时间']))
check('回填后按操作时间从新到旧', JSON.stringify(dates) === JSON.stringify([...dates].sort().reverse()), true)

// 6. 实测值优先：GATE-0008 状态已关闭但实测开度 0.6 → 计入开启
const summary = service.computeSummary('gate')
const opened = summary.stats.find((s) => s.label === '开启闸门')?.value
const closed = summary.stats.find((s) => s.label === '关闭闸门')?.value
check('开启按实测统计(含冲突行)', opened, 6)
check('关闭按实测统计', closed, 9)

// 7. 跨模块台数一致
const overview = service.loadOverview()
const protOverview = overview.modules.find((m) => m.name === '继电保护')?.created
const protSummary = service.computeSummary('protection')
check('继电保护台数跨模块一致', protOverview, protSummary.total)
const dueSoon = protSummary.stats.find((s) => s.label === '即将到期装置')?.value
check('即将到期装置统计', dueSoon, 2)

// 8. 检索定位
const hits = service.searchEntries('gate', 'GATE-0102')
check('检索命中且带 id 可定位', hits.length > 0 && hits[0].id > 0, true)

// 9. 详情返回页码：第 3 页查询在回填后仍稳定（页码被钳制在范围内）
const p99 = service.queryEntries('gate', { size: 5, page: 99 })
check('页码越界钳制到末页', p99.page, Math.ceil(p99.total / 5))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
