export type ModelReference = {
  provider: string
  modelId: string
}

export function formatModelReference(reference: ModelReference) {
  return `${reference.provider}/${reference.modelId}`
}

export function parseModelReference(value: string): ModelReference | undefined {
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  }
}
