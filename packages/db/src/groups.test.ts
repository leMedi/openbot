import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

// A fresh temporary data directory must be configured before the package is
// imported: opening the database, enabling foreign keys, requesting WAL, and
// applying migrations all happen on import (the public startup path).
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-db-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('./index')

let dbModule: DbModule

beforeAll(async () => {
  dbModule = await import('./index')
})

function pngBytes(fill: number) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, fill, fill, fill])
}

async function makeAgents(...names: string[]) {
  const agents = []
  for (const name of names) {
    const { agent } = await dbModule.createAgent({ name })
    agents.push(agent)
  }
  return agents
}

describe('group identity', () => {
  it('creates a group together with exactly one shared conversation', async () => {
    const [alpha] = await makeAgents('Alpha')
    const { group, conversation } = await dbModule.createGroup({
      name: 'Sprint Room',
      description: 'Planning space',
      members: [{ type: 'agent', agentId: alpha.id }],
    })

    expect(group.id).toMatch(/^grp_/)
    expect(group.name).toBe('Sprint Room')
    expect(group.description).toBe('Planning space')
    expect(group.membersJson).toEqual({
      version: 1,
      members: [{ type: 'agent', agentId: alpha.id }],
    })

    // The shared conversation exists, points at the group, and is unique:
    // there is no duplicated conversation pointer on the group row.
    expect(conversation.ownerGroupId).toBe(group.id)
    expect(conversation.ownerAgentId).toBeNull()
    expect(conversation.title).toBe('Sprint Room')
    expect('conversationId' in group).toBe(false)

    const shared = await dbModule.getGroupConversation(group.id)
    expect(shared?.id).toBe(conversation.id)
  })

  it('rejects a second conversation for the same group', async () => {
    const { group } = await dbModule.createGroup({ name: 'Unique Room' })
    await expect(
      dbModule.db.insert(dbModule.conversations).values({
        id: 'cnv_duplicate_room',
        ownerGroupId: group.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ).rejects.toThrow()
  })

  it('lists, gets, updates, and deletes a group', async () => {
    const { group, conversation } = await dbModule.createGroup({ name: 'CRUD Room' })

    const listed = await dbModule.listGroups()
    expect(listed.map((g) => g.id)).toContain(group.id)

    const fetched = await dbModule.getGroup(group.id)
    expect(fetched?.name).toBe('CRUD Room')

    const updated = await dbModule.updateGroupProfile(group.id, {
      name: 'Renamed Room',
      description: 'Now with a purpose',
    })
    expect(updated?.name).toBe('Renamed Room')
    expect(updated?.description).toBe('Now with a purpose')

    expect(await dbModule.deleteGroup(group.id)).toBe(true)
    expect(await dbModule.deleteGroup(group.id)).toBe(false)
    expect(await dbModule.getGroup(group.id)).toBeUndefined()
    // Deleting the group cascades to its shared conversation.
    expect(await dbModule.getConversation(conversation.id)).toBeUndefined()
  })

  it('stores and removes a group avatar through managed files', async () => {
    const { group } = await dbModule.createGroup({ name: 'Avatar Room' })

    const withAvatar = await dbModule.setGroupAvatar(group.id, {
      bytes: pngBytes(1),
      originalName: 'room.png',
      mediaType: 'image/png',
    })
    expect(withAvatar.avatarFileId).toBeTruthy()

    const avatar = await dbModule.getGroupAvatarFile(group.id)
    expect(avatar).toBeDefined()
    expect(Buffer.from(avatar!.bytes)).toEqual(Buffer.from(pngBytes(1)))
    // Bytes live on disk in the managed directory, not in the database.
    const onDisk = await readFile(
      path.join(dataDirectory, 'files', avatar!.file.relativePath),
    )
    expect(Buffer.from(onDisk)).toEqual(Buffer.from(pngBytes(1)))

    const removed = await dbModule.removeGroupAvatar(group.id)
    expect(removed.avatarFileId).toBeNull()
    expect(await dbModule.getGroupAvatarFile(group.id)).toBeUndefined()
  })

  it('rejects an unsupported group avatar upload', async () => {
    const { group } = await dbModule.createGroup({ name: 'Strict Room' })
    await expect(
      dbModule.setGroupAvatar(group.id, {
        bytes: pngBytes(2),
        originalName: 'notes.txt',
        mediaType: 'text/plain',
      }),
    ).rejects.toThrow(/media type/i)
  })
})

describe('group membership', () => {
  it('adds, orders, and removes valid local agents', async () => {
    const [alpha, beta, gamma] = await makeAgents('Alpha', 'Beta', 'Gamma')
    const { group } = await dbModule.createGroup({ name: 'Member Room' })

    const withMembers = await dbModule.setGroupMembers(group.id, [
      { type: 'agent', agentId: alpha.id },
      { type: 'agent', agentId: beta.id },
      { type: 'agent', agentId: gamma.id },
    ])
    expect(withMembers.membersJson.members.map((m) => m.agentId)).toEqual([
      alpha.id,
      beta.id,
      gamma.id,
    ])

    // Reordering and removal happen through the same versioned setter.
    const reordered = await dbModule.setGroupMembers(group.id, [
      { type: 'agent', agentId: gamma.id },
      { type: 'agent', agentId: alpha.id },
    ])
    expect(reordered.membersJson).toEqual({
      version: 1,
      members: [
        { type: 'agent', agentId: gamma.id },
        { type: 'agent', agentId: alpha.id },
      ],
    })
  })

  it('rejects unknown and duplicate member agents', async () => {
    const [alpha] = await makeAgents('Alpha Prime')
    const { group } = await dbModule.createGroup({ name: 'Valid Room' })

    await expect(
      dbModule.setGroupMembers(group.id, [{ type: 'agent', agentId: 'agt_missing' }]),
    ).rejects.toThrow(/agt_missing/)

    await expect(
      dbModule.setGroupMembers(group.id, [
        { type: 'agent', agentId: alpha.id },
        { type: 'agent', agentId: alpha.id },
      ]),
    ).rejects.toThrow(/duplicate/i)

    // Creation validates members the same way.
    await expect(
      dbModule.createGroup({
        name: 'Broken Room',
        members: [{ type: 'agent', agentId: 'agt_missing' }],
      }),
    ).rejects.toThrow(/agt_missing/)
  })
})

describe('group room turns', () => {
  it('accepts a user post as one message plus one queued group-targeted turn', async () => {
    const [alpha] = await makeAgents('Poster Watch')
    const { group, conversation } = await dbModule.createGroup({
      name: 'Post Room',
      members: [{ type: 'agent', agentId: alpha.id }],
    })

    const { message, turn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Morning, room',
    })

    expect(message.role).toBe('user')
    expect(message.bodyText).toBe('Morning, room')
    expect(turn.targetGroupId).toBe(group.id)
    expect(turn.targetAgentId).toBeNull()
    expect(turn.status).toBe('queued')
    expect(turn.lane).toBe('user')

    const rows = await dbModule.listConversationMessages(conversation.id)
    expect(rows).toHaveLength(1)

    const queued = await dbModule.findNextQueuedTurnForGroup(group.id)
    expect(queued?.id).toBe(turn.id)
  })

  it('orders group lanes and permits only one active turn for the target', async () => {
    const [alpha] = await makeAgents('Group Scheduler')
    const { group, conversation } = await dbModule.createGroup({
      name: 'Scheduled Room',
      members: [{ type: 'agent', agentId: alpha.id }],
    })
    const background = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'old background work',
    })
    const delegated = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'agent work',
    })
    const user = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'new user work',
    })
    await dbModule.db
      .update(dbModule.turns)
      .set({ lane: 'background', createdAt: 1 })
      .where(eq(dbModule.turns.id, background.turn.id))
    await dbModule.db
      .update(dbModule.turns)
      .set({ lane: 'agent', createdAt: 2 })
      .where(eq(dbModule.turns.id, delegated.turn.id))
    await dbModule.db
      .update(dbModule.turns)
      .set({ createdAt: 3 })
      .where(eq(dbModule.turns.id, user.turn.id))

    expect((await dbModule.findNextQueuedTurnForGroup(group.id))?.id).toBe(
      user.turn.id,
    )
    expect(await dbModule.claimQueuedTurn(background.turn.id)).toBeUndefined()
    await dbModule.claimQueuedTurn(user.turn.id)
    expect(await dbModule.findNextQueuedTurnForGroup(group.id)).toBeUndefined()
    expect(await dbModule.claimQueuedTurn(delegated.turn.id)).toBeUndefined()

    await dbModule.completeTurn(user.turn.id, { status: 'succeeded' })
    expect((await dbModule.findNextQueuedTurnForGroup(group.id))?.id).toBe(
      delegated.turn.id,
    )
  })

  it('queues an agent-targeted child turn linked to the running group turn', async () => {
    const [alpha] = await makeAgents('Child Runner')
    const { group, conversation } = await dbModule.createGroup({
      name: 'Child Room',
      members: [{ type: 'agent', agentId: alpha.id }],
    })
    const { turn: groupTurn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Someone take this',
    })
    const claimed = await dbModule.claimQueuedTurn(groupTurn.id)
    expect(claimed?.status).toBe('running')

    const { childTurn, groupTurn: settled } = await dbModule.queueGroupChildTurn({
      groupTurnId: groupTurn.id,
      targetAgentId: alpha.id,
      orchestrationRound: 0,
      positionInRound: 0,
    })

    expect(childTurn.conversationId).toBe(conversation.id)
    expect(childTurn.targetAgentId).toBe(alpha.id)
    expect(childTurn.targetGroupId).toBeNull()
    expect(childTurn.parentTurnId).toBe(groupTurn.id)
    expect(childTurn.lane).toBe('agent')
    expect(childTurn.orchestrationRound).toBe(0)
    expect(childTurn.positionInRound).toBe(0)
    expect(childTurn.status).toBe('queued')
    // The orchestration turn settles in the same transaction.
    expect(settled.status).toBe('succeeded')

    const children = await dbModule.findChildTurns(groupTurn.id)
    expect(children.map((t) => t.id)).toEqual([childTurn.id])
    const queued = await dbModule.findNextQueuedTurnForAgent(alpha.id)
    expect(queued?.id).toBe(childTurn.id)
  })

  it('rejects a child turn for an unclaimed or agent-targeted parent', async () => {
    const [alpha] = await makeAgents('Guard Rail')
    const { conversation } = await dbModule.createGroup({
      name: 'Guard Room',
      members: [{ type: 'agent', agentId: alpha.id }],
    })
    const { turn: groupTurn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Still queued',
    })

    // Still queued: the orchestrator must claim before delegating.
    await expect(
      dbModule.queueGroupChildTurn({ groupTurnId: groupTurn.id, targetAgentId: alpha.id }),
    ).rejects.toThrow(/running/i)
  })

  it("records the member's identity on the group transcript and leaves private rooms untouched", async () => {
    const [alpha] = await makeAgents('Identity Keeper')
    const privateConversation = await dbModule.getConversation(
      (await dbModule.listConversations()).find((c) => c.ownerAgentId === alpha.id)!.id,
    )
    const { group, conversation } = await dbModule.createGroup({
      name: 'Identity Room',
      members: [{ type: 'agent', agentId: alpha.id }],
    })

    const { turn: groupTurn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Who am I talking to?',
    })
    await dbModule.claimQueuedTurn(groupTurn.id)
    const { childTurn } = await dbModule.queueGroupChildTurn({
      groupTurnId: groupTurn.id,
      targetAgentId: alpha.id,
    })
    await dbModule.claimQueuedTurn(childTurn.id)

    // Delivered rows are appended in-flight (the SendMessage path) with the
    // member's identity; finalize commits only checkpoint and status.
    const message = await dbModule.appendConversationMessage({
      conversationId: conversation.id,
      kind: 'message',
      role: 'assistant',
      direction: 'outbound',
      bodyText: 'You are talking to Identity Keeper.',
      turnId: childTurn.id,
      senderAgentId: alpha.id,
    })
    await dbModule.finalizeTurnSuccess({
      turnId: childTurn.id,
      conversationId: conversation.id,
      checkpointState: { version: 1, modelMessages: [] },
    })

    expect(message.senderAgentId).toBe(alpha.id)
    expect(message.role).toBe('assistant')
    expect(message.conversationId).toBe(conversation.id)

    // The response lives only in the group transcript; the member's private
    // conversation gained no rows.
    const groupRows = await dbModule.listConversationMessages(conversation.id)
    expect(groupRows.some((r) => r.senderAgentId === alpha.id)).toBe(true)
    const privateRows = await dbModule.listConversationMessages(privateConversation!.id)
    expect(privateRows).toHaveLength(0)

    expect(group.id).toBe((await dbModule.getGroup(group.id))!.id)
  })
})
