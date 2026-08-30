#!/usr/bin/env node

import * as p from '@clack/prompts'
import { defineCommand, runMain } from 'citty'
import { type CleanTarget, cleanTargets } from './targets'

const labels: Record<CleanTarget, string> = {
  bots: 'Bots',
  conversations: 'Conversations',
  mcps: 'MCP servers and accounts',
}

const clean = defineCommand({
  meta: {
    name: 'clean',
    description: 'Delete selected OpenBot data',
  },
  args: {
    bots: {
      type: 'boolean',
      description: 'Delete all bots and their dependent data',
    },
    conversations: {
      type: 'boolean',
      description: 'Delete all conversations and their dependent data',
    },
    mcps: {
      type: 'boolean',
      description: 'Delete all MCP servers, accounts, and bot access',
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Skip the confirmation prompt',
    },
  },
  async run({ args }) {
    const knownArgs = new Set([...cleanTargets, 'yes', 'y', '_'])
    const unknownArgs = Object.keys(args).filter((arg) => !knownArgs.has(arg))
    if (unknownArgs.length > 0 || args._.length > 0) {
      const unknown = [
        ...unknownArgs.map((arg) => `--${arg}`),
        ...args._,
      ].join(', ')
      p.cancel(`Unknown argument${unknown.includes(',') ? 's' : ''}: ${unknown}`)
      process.exitCode = 1
      return
    }

    let targets = cleanTargets.filter((target) => args[target])

    if (targets.length === 0) {
      p.intro('Clean OpenBot data')
      const selected = await p.multiselect({
        message: 'What do you want to delete?',
        options: cleanTargets.map((target) => ({
          value: target,
          label: labels[target],
        })),
        required: true,
      })

      if (p.isCancel(selected)) {
        p.cancel('Clean cancelled')
        return
      }
      targets = selected
    }

    if (!args.yes) {
      const confirmed = await p.confirm({
        message: `Permanently delete ${targets.map((target) => labels[target]).join(', ')}?`,
      })
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Clean cancelled')
        return
      }
    }

    const progress = p.spinner()
    progress.start('Deleting selected data')

    try {
      const { cleanData } = await import('./clean')
      const result = await cleanData(new Set(targets))
      progress.stop('Selected data deleted')
      const summary = targets
        .map((target) => `${labels[target]}: ${result[target] ?? 0}`)
        .join('\n')
      p.outro(summary)
    } catch (error) {
      progress.stop('Clean failed')
      throw error
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'openbot-tools',
    version: '0.0.0',
    description: 'OpenBot development tools',
  },
  subCommands: { clean },
})

await runMain(main)
