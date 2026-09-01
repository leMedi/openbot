import {
  memoryItemCreateInput,
  memoryItemSelector,
  memoryListInput,
  memoryUpdateInput,
} from '@openbot/memory'
import { createServerFn } from '@tanstack/react-start'

export const getMemoryItems = createServerFn({ method: 'GET' })
  .validator((input: unknown) => memoryListInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/memory')).listMemory(data))

export const getMemoryItemById = createServerFn({ method: 'GET' })
  .validator((input: unknown) => memoryItemSelector.parse(input))
  .handler(async ({ data }) => (await import('@openbot/memory')).findMemory(data))

export const addMemoryItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryItemCreateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/memory')).createMemory(data))

export const updateMemory = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryUpdateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/memory')).changeMemory(data))

export const removeMemoryItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryItemSelector.parse(input))
  .handler(async ({ data }) => (await import('@openbot/memory')).forgetMemory(data))
