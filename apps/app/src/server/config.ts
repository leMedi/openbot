import { createServerFn } from '@tanstack/react-start'

// Model selection is fixed by server configuration until the model providers
// and listing feature lands; clients display it read-only.
export const getServerConfig = createServerFn({ method: 'GET' }).handler(() => ({
  model: process.env.OPENBOT_AI_MODEL ?? '',
}))
