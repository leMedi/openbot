import type { PromptToolCapabilities } from './system'
import type { TurnAction } from './action'
import type { TurnPolicy } from './policy'
import type { CollectedConversationTurnContext } from '../queue/turn-context'
import {
  prepareBrowserUseWorkerTurn,
  prepareComputerUseWorkerTurn,
  prepareConversationTurn,
  prepareGeneralSubagentTurn,
} from './assembly'

/** Final typed handoff from collected context and current action to Pi. */
export async function projectPiTurnInput(input: {
  action: TurnAction
  context: CollectedConversationTurnContext
  policy: TurnPolicy
  turnId: string
  mcpToolCount: number
  toolCapabilities: PromptToolCapabilities
}) {
  const action = input.action
  const workerAction = action.kind !== 'conversation'
  if ((input.policy.history === 'isolated-worker') !== workerAction) {
    throw new Error('Turn action and history policy disagree')
  }
  const common = {
    conversationId: input.context.conversation.id,
    turnId: input.turnId,
    workspace: input.context.workspace,
  }
  if (action.kind === 'general-subagent') {
    return prepareGeneralSubagentTurn({
      ...common,
      task: action.task,
      resumedText: action.resumedText,
      desktopEnabled: input.context.desktopEnabled,
      mcpToolCount: input.mcpToolCount,
    })
  }
  if (action.kind === 'browser-use') {
    return prepareBrowserUseWorkerTurn({
      ...common,
      task: action.task,
      resumedText: action.resumedText,
    })
  }
  if (action.kind === 'computer-use') {
    return prepareComputerUseWorkerTurn({
      ...common,
      task: action.task,
      resumedText: action.resumedText,
    })
  }
  return prepareConversationTurn({
    agent: input.context.agent,
    userProfile: input.context.userProfile,
    availableAgents: input.context.availableAgents,
    availableGroups: input.context.availableGroups,
    memory: input.context.memory,
    routines: input.context.routines,
    conversation: input.context.promptConversation,
    agentMainConversationId: input.context.agentMainConversation.id,
    ...common,
    resumedText: action.resumedText,
    hiddenWakePrompt: action.hiddenWakePrompt,
    prependedMessages: action.prependedMessages,
    onboardingPurpose: action.onboardingPurpose,
    mcpToolCount: input.mcpToolCount,
    toolCapabilities: input.toolCapabilities,
  })
}
