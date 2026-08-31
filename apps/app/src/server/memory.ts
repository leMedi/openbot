import { createServerFn } from '@tanstack/react-start'
import {
  memoryItemCreateInput,
  memoryItemSelector,
  memoryListInput,
  memoryUpdateInput,
} from './memory-contract'

export const getMemoryItems = createServerFn({ method: 'GET' })
  .validator((input: unknown) => memoryListInput.parse(input))
  .handler(async ({ data }) =>
    (await import('./memory-handlers.server')).listMemory(data),
  )

export const getMemoryItemById = createServerFn({ method: 'GET' })
  .validator((input: unknown) => memoryItemSelector.parse(input))
  .handler(async ({ data }) =>
    (await import('./memory-handlers.server')).findMemory(data),
  )

export const addMemoryItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryItemCreateInput.parse(input))
  .handler(async ({ data }) =>
    (await import('./memory-handlers.server')).createMemory(data),
  )

export const updateMemory = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryUpdateInput.parse(input))
  .handler(async ({ data }) =>
    (await import('./memory-handlers.server')).changeMemory(data),
  )

export const removeMemoryItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memoryItemSelector.parse(input))
  .handler(async ({ data }) =>
    (await import('./memory-handlers.server')).forgetMemory(data),
  )
