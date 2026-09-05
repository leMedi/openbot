#!/usr/bin/env node

import { parseStartWindowArguments, provisionAgentWindow } from './start-window-core'
import { systemDependencies } from './xvfb'

async function main() {
  let exitCode = 1
  try {
    const input = parseStartWindowArguments(process.argv.slice(2))
    const result = await provisionAgentWindow(input, systemDependencies())
    exitCode = result.exitCode
    if (result.error) process.stderr.write(`${result.error}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = exitCode
}

void main()
