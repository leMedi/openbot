import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import deliveredMessage from './delivered-message'
import didNotInstallPlugin from './did-not-install-plugin'
import proposedTicketPlugins from './proposed-ticket-plugins'
import usedSearchPlugins from './used-search-plugins'

function context(toolNames: string[], searchResult = '') {
  return {
    providerResponse: {
      metadata: {
        status: 'succeeded',
        agentId: 'agt_test',
        turnId: 'trn_test',
        deliveries: [],
        toolCalls: toolNames.map((name, index) => ({
          id: `call_${index}`,
          name,
          arguments: name === 'SearchPlugins' ? { query: 'ticket issue tracker' } : {},
          ...(name === 'SearchPlugins' && {
            result: { text: searchResult, isError: false },
          }),
          ...(name !== 'SearchPlugins' && {
            result: { text: '{"ok":true}', isError: false },
          }),
        })),
      },
    },
  }
}

describe('PO eval assertions', () => {
  it('requires plugin discovery and SendMessage delivery', () => {
    const passing = context(['SearchPlugins', 'SendMessage'])
    assert.equal(usedSearchPlugins('', passing).pass, true)
    assert.equal(deliveredMessage('', passing).pass, true)
    assert.equal(usedSearchPlugins('', context(['SendMessage'])).pass, false)
    assert.equal(deliveredMessage('', context(['SearchPlugins'])).pass, false)
  })

  it('accepts a successful plugin search after a failed attempt', () => {
    const retry = context(['SearchPlugins'])
    const metadata = retry.providerResponse.metadata
    metadata.toolCalls.unshift({
      id: 'call_failed',
      name: 'SearchPlugins',
      arguments: { query: 'tickets' },
      result: { text: 'temporary failure', isError: true },
    })
    assert.equal(usedSearchPlugins('', retry).pass, true)
  })

  it('requires at least two ticketing choices and a selection prompt', () => {
    assert.equal(
      proposedTicketPlugins(
        'I found Linear and Jira. Which one should I connect?',
        context(['SearchPlugins'], 'linear: Linear — Issues\natlassian: Jira — Issues'),
      ).pass,
      true,
    )
    assert.equal(proposedTicketPlugins('I found Linear.', context(['SearchPlugins'], 'linear: Linear — Issues')).pass, false)
    assert.equal(
      proposedTicketPlugins(
        'Linear and Jira are available.',
        context(['SearchPlugins'], 'linear: Linear — Issues\natlassian: Jira — Issues'),
      ).pass,
      false,
    )
    assert.equal(
      proposedTicketPlugins(
        'I can connect Linear and Jira.',
        context(['SearchPlugins'], 'linear: Linear — Issues\natlassian: Jira — Issues'),
      ).pass,
      false,
    )
  })

  it('rejects an unrequested plugin installation', () => {
    assert.equal(didNotInstallPlugin('', context(['SearchPlugins'])).pass, true)
    assert.equal(didNotInstallPlugin('', context(['InstallPlugin'])).pass, false)
  })
})
