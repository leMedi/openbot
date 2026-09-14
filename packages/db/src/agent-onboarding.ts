import type { WaitingState } from './json-schemas'

export const AGENT_ONBOARDING_COPY = {
  greeting: (agentName: string) =>
    `Hi - I’m ${agentName}. Let’s set up how I can help you.`,
  purposeQuestion: 'What would you mainly like my help with?',
  purposeHelp: 'Choose a starting point. You can refine this with me at any time.',
  purposes: [
    {
      id: 'day-to-day',
      label: 'Day-to-day',
      description: 'Email, calendar, notes and keeping things moving',
      followUp: `Perfect! That's where I can take most off your plates. Where do those live for you right now?`,
    },
    {
      id: 'building-coding',
      label: 'Building & coding',
      description: 'Repos, features, debugging, side projects',
      followUp: 'What are you building, and which languages, tools, or constraints should I know about?',
    },
    {
      id: 'research-writing',
      label: 'Research & writing',
      description: 'Looking things up, Draft Summaries',
      followUp: 'What topics and kinds of research or writing should I help you with?',
    },
    {
      id: 'something-specific',
      label: 'Something specific',
      description: `You've got a concrete job in mind`,
      followUp: 'Tell me the specific role, outcome, or project you want me to focus on.',
    },
  ],
  customFollowUp: 'Tell me more about that goal and what a useful result would look like.',
} as const

export const AGENT_ONBOARDING_TOOL_NAME = 'AgentOnboarding'

export function agentOnboardingToolCallId(agentId: string) {
  return `agent-onboarding-purpose-${agentId}`
}

export function agentOnboardingWaitingState(agentId: string): WaitingState {
  return {
    version: 1,
    interactionKind: 'question',
    prompt: AGENT_ONBOARDING_COPY.purposeQuestion,
    helpText: AGENT_ONBOARDING_COPY.purposeHelp,
    options: AGENT_ONBOARDING_COPY.purposes.map(({ id, label, description }) => ({
      id,
      label,
      description,
    })),
    allowCustom: true,
    dismissOnMoveOn: false,
    originatingToolCall: {
      id: agentOnboardingToolCallId(agentId),
      name: AGENT_ONBOARDING_TOOL_NAME,
    },
    resumeData: { version: 1, type: 'agent-onboarding-purpose' },
    response: null,
  }
}

export function agentOnboardingFollowUp(optionId: string | null) {
  return AGENT_ONBOARDING_COPY.purposes.find((purpose) => purpose.id === optionId)?.followUp
    ?? AGENT_ONBOARDING_COPY.customFollowUp
}
