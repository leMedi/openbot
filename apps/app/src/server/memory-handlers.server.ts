import {
  createMemoryItem,
  deleteMemoryItem,
  getMemoryItem,
  listMemoryItems,
  updateMemoryItem,
} from '@openbot/db'
import {
  memoryItemCreateInput,
  memoryItemSelector,
  memoryListInput,
  memoryUpdateInput,
} from './memory-contract'

export function listMemory(input: unknown) {
  return listMemoryItems(memoryListInput.parse(input))
}

export async function findMemory(input: unknown) {
  const selector = memoryItemSelector.parse(input)
  const item = await getMemoryItem(selector)
  if (!item) throw new Error(`Memory item ${selector.id} not found`)
  return item
}

export function createMemory(input: unknown) {
  return createMemoryItem(memoryItemCreateInput.parse(input))
}

export async function changeMemory(input: unknown) {
  const data = memoryUpdateInput.parse(input)
  const updated = await updateMemoryItem(data.selector, data.patch)
  if (!updated) throw new Error(`Memory item ${data.selector.id} not found`)
  return updated
}

export async function forgetMemory(input: unknown) {
  const selector = memoryItemSelector.parse(input)
  if (!(await deleteMemoryItem(selector))) {
    throw new Error(`Memory item ${selector.id} not found`)
  }
  return { id: selector.id }
}
