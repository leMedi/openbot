import { agents } from './procedures/agents'
import { config } from './procedures/config'
import { conversations } from './procedures/conversations'
import { data } from './procedures/data'
import { groups } from './procedures/groups'
import { logs } from './procedures/logs'
import { mcp } from './procedures/mcp'
import { memory } from './procedures/memory'
import { messages } from './procedures/messages'
import { profile } from './procedures/profile'
import { providers } from './procedures/providers'
import { routines } from './procedures/routines'
import { subagents } from './procedures/subagents'

export const router = {
  agents,
  config,
  conversations,
  data,
  groups,
  logs,
  mcp,
  memory,
  messages,
  profile,
  providers,
  routines,
  subagents,
}

export type AppRouter = typeof router
