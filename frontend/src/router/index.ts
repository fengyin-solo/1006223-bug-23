import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
import ModuleDetailPage from '@/components/ModuleDetailPage.vue'
import { MODULES } from '@/data/modules'

const Station = () => import('@/views/station/index.vue')
const Unit = () => import('@/views/unit/index.vue')
const Governor = () => import('@/views/governor/index.vue')
const Excitation = () => import('@/views/excitation/index.vue')
const Transformer = () => import('@/views/transformer/index.vue')
const Gate = () => import('@/views/gate/index.vue')
const Seepage = () => import('@/views/seepage/index.vue')
const Displacement = () => import('@/views/displacement/index.vue')
const Trashrack = () => import('@/views/trashrack/index.vue')
const Overhaul = () => import('@/views/overhaul/index.vue')
const Bearing = () => import('@/views/bearing/index.vue')
const Cooling = () => import('@/views/cooling/index.vue')
const Hydrology = () => import('@/views/hydrology/index.vue')
const Flood = () => import('@/views/flood/index.vue')
const Generation = () => import('@/views/generation/index.vue')
const Protection = () => import('@/views/protection/index.vue')
const Defect = () => import('@/views/defect/index.vue')
const Crew = () => import('@/views/crew/index.vue')
const Spare = () => import('@/views/spare/index.vue')

const LIST_COMPONENTS: Record<string, () => Promise<unknown>> = {
  station: Station,
  unit: Unit,
  governor: Governor,
  excitation: Excitation,
  transformer: Transformer,
  gate: Gate,
  seepage: Seepage,
  displacement: Displacement,
  trashrack: Trashrack,
  overhaul: Overhaul,
  bearing: Bearing,
  cooling: Cooling,
  hydrology: Hydrology,
  flood: Flood,
  generation: Generation,
  protection: Protection,
  defect: Defect,
  crew: Crew,
  spare: Spare,
}

const moduleRoutes = MODULES.flatMap((meta) => [
  { path: `/${meta.key}`, name: meta.key, component: LIST_COMPONENTS[meta.key] },
  {
    path: `/${meta.key}/:id(\\d+)`,
    name: `${meta.key}-detail`,
    component: ModuleDetailPage,
    props: (route: { params: Record<string, string> }) => ({
      moduleKey: meta.key,
      id: Number(route.params.id),
    }),
  },
])

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', name: 'dashboard', component: Dashboard }, ...moduleRoutes],
})

export default router
