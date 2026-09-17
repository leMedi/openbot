import {
  memoryItemCreateInput,
  memoryItemSelector,
  memoryListInput,
  memoryUpdateInput,
} from '@openbot/memory'
import { base } from '../base'

const store = () => import('@openbot/memory')

export const memory = {
  list: base.input(memoryListInput).handler(async ({ input }) => (await store()).listMemory(input)),
  get: base.input(memoryItemSelector).handler(async ({ input }) => (await store()).findMemory(input)),
  create: base.input(memoryItemCreateInput).handler(async ({ input }) => (await store()).createMemory(input)),
  update: base.input(memoryUpdateInput).handler(async ({ input }) => (await store()).changeMemory(input)),
  remove: base.input(memoryItemSelector).handler(async ({ input }) => (await store()).forgetMemory(input)),
}
