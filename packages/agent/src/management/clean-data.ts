import {
  cleanData as cleanDurableData,
  type CleanResult,
  type CleanTarget,
  listAgents,
} from '@openbot/db'
import { deleteAgent } from './delete-agent'

/** Clear selected data while honoring runtime teardown for managed agents. */
export async function cleanManagedData(targets: ReadonlySet<CleanTarget>) {
  if (!targets.has('bots')) return cleanDurableData(targets)

  let deletedAgents = 0
  for (const agent of await listAgents()) {
    if (await deleteAgent(agent.id)) deletedAgents++
  }
  const result: CleanResult = { bots: deletedAgents }

  const durableTargets = new Set(targets)
  durableTargets.delete('bots')
  if (durableTargets.size > 0) {
    Object.assign(result, await cleanDurableData(durableTargets))
  }
  return result
}
