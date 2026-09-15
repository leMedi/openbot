import {
  getAgent,
  getGroup,
  getMainAgentConversation,
  getProfile,
  listAgents,
  listGroups,
  listPromptMemoryForAgent,
  listRoutines,
  type Agent,
  type Conversation,
  type Group,
} from '@openbot/db'
import { isAgentDesktopEnabled } from '../desktop/mode'
import type { ConversationPromptContext } from '../prompt/system'
import { agentWorkspaceDirectory } from '../tools/shell/workspace'

export type CollectedConversationTurnContext = Awaited<
  ReturnType<typeof collectConversationTurnContext>
>

/** Collects the live data domains that can affect one Pi turn. */
export async function collectConversationTurnContext(input: {
  agent: Agent
  conversation: Conversation
  group?: Group
  members?: Agent[]
}) {
  const [
    agentMainConversation,
    group,
    memory,
    routines,
    availableAgents,
    availableGroups,
    userProfile,
  ] = await Promise.all([
      getMainAgentConversation(input.agent.id),
      input.group ?? (
        input.conversation.ownerGroupId ? getGroup(input.conversation.ownerGroupId) : undefined
      ),
      listPromptMemoryForAgent(input.agent.id),
      listRoutines(input.agent.id),
      listAgents(),
      listGroups(),
      getProfile(),
    ])
  if (!agentMainConversation) {
    throw new Error(`Agent ${input.agent.id} has no main conversation`)
  }
  if (input.conversation.ownerGroupId && !group) {
    throw new Error(`Group ${input.conversation.ownerGroupId} not found`)
  }
  const members = input.members ?? (group
    ? (await Promise.all(group.membersJson.members
        .filter((member) => member.type === 'agent')
        .map((member) => getAgent(member.agentId))))
        .filter((member): member is Agent => !!member)
    : [])
  const promptConversation: ConversationPromptContext = group
    ? { kind: 'group', group, members }
    : { kind: 'private' }
  return {
    agent: input.agent,
    conversation: input.conversation,
    agentMainConversation,
    group,
    members,
    promptConversation,
    memory,
    routines,
    availableAgents,
    availableGroups,
    userProfile,
    workspace: agentWorkspaceDirectory(input.agent.id),
    desktopEnabled: isAgentDesktopEnabled(input.agent.xDisplayNumber),
  }
}
