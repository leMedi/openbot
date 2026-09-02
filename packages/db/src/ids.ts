import { randomBytes } from 'node:crypto'

export type IdPrefix =
  | 'agt'
  | 'grp'
  | 'cnv'
  | 'chk'
  | 'trn'
  | 'ent'
  | 'mem'
  | 'fil'
  | 'dlv'
  | 'mcp'
  | 'acc'

export function createId(prefix: IdPrefix) {
  return `${prefix}_${randomBytes(16).toString('base64url')}`
}
