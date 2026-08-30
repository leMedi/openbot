export const cleanTargets = ['bots', 'conversations', 'mcps'] as const

export type CleanTarget = (typeof cleanTargets)[number]
