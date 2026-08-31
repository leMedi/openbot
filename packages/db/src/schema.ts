import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type {
  Attachments,
  EffectiveTools,
  GroupMembers,
  McpCredentials,
  Reactions,
  VersionedObject,
  WaitingState,
} from './json-schemas'

const emptyVersionedObject = sql`'{"version":1}'`
const emptyGroupMembers = sql`'{"version":1,"members":[]}'`
const emptyAttachments = sql`'{"version":1,"items":[]}'`
const emptyReactions = sql`'{"version":1,"items":[]}'`
const emptyTools = sql`'{"version":1,"tools":[]}'`

export const managedFiles = sqliteTable('managed_files', {
  id: text('id').primaryKey(),
  relativePath: text('relative_path').notNull().unique(),
  originalName: text('original_name').notNull(),
  mediaType: text('media_type'),
  byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  check('managed_files_byte_size_check', sql`${table.byteSize} >= 0`),
])

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarFileId: text('avatar_file_id').references(() => managedFiles.id, {
    onDelete: 'set null',
  }),
  avatarShape: text('avatar_shape').notNull().default('squircle'),
  avatarColor: text('avatar_color').notNull().default('#5865c4'),
  defaultMode: text('default_mode').notNull().default('default'),
  defaultModel: text('default_model'),
  approvalMode: text('approval_mode').notNull().default('allowlist'),
  notifyOnUpdates: integer('notify_on_updates', { mode: 'boolean' })
    .notNull()
    .default(true),
  hiddenFromSidebar: integer('hidden_from_sidebar', { mode: 'boolean' })
    .notNull()
    .default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarFileId: text('avatar_file_id').references(() => managedFiles.id, {
    onDelete: 'set null',
  }),
  membersJson: text('members_json', { mode: 'json' })
    .$type<GroupMembers>()
    .notNull()
    .default(emptyGroupMembers),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('groups_members_json_check', sql`json_valid(${table.membersJson})`),
])

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  ownerAgentId: text('owner_agent_id').references(() => agents.id, {
    onDelete: 'cascade',
  }),
  ownerGroupId: text('owner_group_id').references(() => groups.id, {
    onDelete: 'cascade',
  }),
  title: text('title'),
  currentCheckpointId: text('current_checkpoint_id').references(
    (): AnySQLiteColumn => conversationCheckpoints.id,
  ),
  currentPlanUri: text('current_plan_uri'),
  nextSequenceNo: integer('next_sequence_no').notNull().default(1),
  lastReadSequenceNo: integer('last_read_sequence_no').notNull().default(0),
  manuallyUnread: integer('manually_unread', { mode: 'boolean' })
    .notNull()
    .default(false),
  introductionPending: integer('introduction_pending', { mode: 'boolean' })
    .notNull()
    .default(false),
  origin: text('origin'),
  purpose: text('purpose'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check(
    'conversations_owner_check',
    sql`(${table.ownerAgentId} IS NOT NULL) <> (${table.ownerGroupId} IS NOT NULL)`,
  ),
  check(
    'conversations_sequence_check',
    sql`${table.nextSequenceNo} > 0 AND ${table.lastReadSequenceNo} >= 0`,
  ),
  uniqueIndex('conversations_group_owner_unique')
    .on(table.ownerGroupId)
    .where(sql`${table.ownerGroupId} IS NOT NULL`),
  index('conversations_agent_owner_idx').on(table.ownerAgentId, table.updatedAt),
])

export const conversationCheckpoints = sqliteTable('conversation_checkpoints', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  parentCheckpointId: text('parent_checkpoint_id'),
  schemaVersion: integer('schema_version').notNull(),
  stateJson: text('state_json', { mode: 'json' }).$type<VersionedObject>().notNull(),
  byteSize: integer('byte_size').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  check('checkpoints_schema_version_check', sql`${table.schemaVersion} > 0`),
  check('checkpoints_state_json_check', sql`json_valid(${table.stateJson})`),
  check('checkpoints_byte_size_check', sql`${table.byteSize} >= 0`),
  check('checkpoints_hash_check', sql`length(${table.contentHash}) = 64`),
  uniqueIndex('checkpoints_conversation_id_unique').on(table.conversationId, table.id),
  foreignKey({
    columns: [table.conversationId, table.parentCheckpointId],
    foreignColumns: [table.conversationId, table.id],
    name: 'checkpoints_parent_fk',
  }),
  index('checkpoints_conversation_created_idx').on(
    table.conversationId,
    table.createdAt,
  ),
])

export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  targetAgentId: text('target_agent_id').references(() => agents.id, {
    onDelete: 'cascade',
  }),
  targetGroupId: text('target_group_id').references(() => groups.id, {
    onDelete: 'cascade',
  }),
  parentTurnId: text('parent_turn_id').references(
    (): AnySQLiteColumn => turns.id,
    { onDelete: 'set null' },
  ),
  lane: text('lane').notNull(),
  source: text('source').notNull(),
  status: text('status').notNull().default('queued'),
  mode: text('mode').notNull().default('default'),
  modelProvider: text('model_provider'),
  modelId: text('model_id'),
  requestId: text('request_id').unique(),
  idempotencyKey: text('idempotency_key').unique(),
  effectiveToolsJson: text('effective_tools_json', { mode: 'json' })
    .$type<EffectiveTools>()
    .notNull()
    .default(emptyTools),
  effectivePermissionsJson: text('effective_permissions_json', { mode: 'json' })
    .$type<VersionedObject>()
    .notNull()
    .default(emptyVersionedObject),
  runtimeContextJson: text('runtime_context_json', { mode: 'json' })
    .$type<VersionedObject>()
    .notNull()
    .default(emptyVersionedObject),
  waitingStateJson: text('waiting_state_json', { mode: 'json' }).$type<WaitingState>(),
  errorJson: text('error_json', { mode: 'json' }).$type<VersionedObject>(),
  attemptCount: integer('attempt_count').notNull().default(0),
  orchestrationRound: integer('orchestration_round'),
  positionInRound: integer('position_in_round'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check(
    'turns_target_check',
    sql`(${table.targetAgentId} IS NOT NULL) <> (${table.targetGroupId} IS NOT NULL)`,
  ),
  check('turns_lane_check', sql`${table.lane} IN ('user', 'agent', 'background')`),
  check(
    'turns_status_check',
    sql`${table.status} IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')`,
  ),
  check('turns_attempt_count_check', sql`${table.attemptCount} >= 0`),
  check(
    'turns_orchestration_check',
    sql`(${table.orchestrationRound} IS NULL OR ${table.orchestrationRound} >= 0)
      AND (${table.positionInRound} IS NULL OR ${table.positionInRound} >= 0)`,
  ),
  check('turns_tools_json_check', sql`json_valid(${table.effectiveToolsJson})`),
  check(
    'turns_permissions_json_check',
    sql`json_valid(${table.effectivePermissionsJson})`,
  ),
  check('turns_runtime_json_check', sql`json_valid(${table.runtimeContextJson})`),
  check(
    'turns_waiting_json_check',
    sql`${table.waitingStateJson} IS NULL OR json_valid(${table.waitingStateJson})`,
  ),
  check(
    'turns_error_json_check',
    sql`${table.errorJson} IS NULL OR json_valid(${table.errorJson})`,
  ),
  uniqueIndex('turns_conversation_id_unique').on(table.conversationId, table.id),
  index('turns_queue_idx').on(table.status, table.lane, table.createdAt),
  index('turns_conversation_idx').on(table.conversationId, table.createdAt),
  index('turns_parent_idx').on(table.parentTurnId),
])

export const conversationMessages = sqliteTable('conversation_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  turnId: text('turn_id'),
  sequenceNo: integer('sequence_no').notNull(),
  kind: text('kind').notNull(),
  role: text('role'),
  direction: text('direction').notNull(),
  senderAgentId: text('sender_agent_id').references(() => agents.id, {
    onDelete: 'set null',
  }),
  recipientAgentId: text('recipient_agent_id').references(() => agents.id, {
    onDelete: 'set null',
  }),
  deliveryId: text('delivery_id'),
  bodyText: text('body_text'),
  payloadJson: text('payload_json', { mode: 'json' })
    .$type<VersionedObject>()
    .notNull()
    .default(emptyVersionedObject),
  replyToEntryId: text('reply_to_entry_id'),
  threadRootEntryId: text('thread_root_entry_id'),
  branchParentEntryId: text('branch_parent_entry_id'),
  reactionsJson: text('reactions_json', { mode: 'json' })
    .$type<Reactions>()
    .notNull()
    .default(emptyReactions),
  attachmentsJson: text('attachments_json', { mode: 'json' })
    .$type<Attachments>()
    .notNull()
    .default(emptyAttachments),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('messages_sequence_check', sql`${table.sequenceNo} > 0`),
  check(
    'messages_kind_check',
    sql`${table.kind} IN ('message', 'tool_call', 'tool_result', 'status', 'system', 'other')`,
  ),
  check(
    'messages_role_check',
    sql`${table.role} IS NULL OR ${table.role} IN ('user', 'assistant', 'system', 'tool')`,
  ),
  check(
    'messages_direction_check',
    sql`${table.direction} IN ('inbound', 'outbound', 'internal')`,
  ),
  check('messages_payload_json_check', sql`json_valid(${table.payloadJson})`),
  check('messages_reactions_json_check', sql`json_valid(${table.reactionsJson})`),
  check('messages_attachments_json_check', sql`json_valid(${table.attachmentsJson})`),
  uniqueIndex('messages_conversation_sequence_unique').on(
    table.conversationId,
    table.sequenceNo,
  ),
  uniqueIndex('messages_conversation_id_unique').on(table.conversationId, table.id),
  foreignKey({
    columns: [table.conversationId, table.turnId],
    foreignColumns: [turns.conversationId, turns.id],
    name: 'messages_turn_fk',
  }),
  foreignKey({
    columns: [table.conversationId, table.replyToEntryId],
    foreignColumns: [table.conversationId, table.id],
    name: 'messages_reply_fk',
  }),
  foreignKey({
    columns: [table.conversationId, table.threadRootEntryId],
    foreignColumns: [table.conversationId, table.id],
    name: 'messages_thread_fk',
  }),
  foreignKey({
    columns: [table.conversationId, table.branchParentEntryId],
    foreignColumns: [table.conversationId, table.id],
    name: 'messages_branch_fk',
  }),
  index('messages_turn_idx').on(table.turnId, table.sequenceNo),
  index('messages_delivery_idx').on(table.deliveryId),
  index('messages_reply_idx').on(table.replyToEntryId),
  index('messages_thread_idx').on(table.threadRootEntryId, table.sequenceNo),
])

export const memoryItems = sqliteTable('memory_items', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  subjectAgentId: text('subject_agent_id').references(() => agents.id, {
    onDelete: 'cascade',
  }),
  authoredByAgentId: text('authored_by_agent_id').references(() => agents.id, {
    onDelete: 'set null',
  }),
  // Denormalized so "[via <assistant>]" provenance survives author deletion.
  authoredByAgentName: text('authored_by_agent_name'),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  metadataJson: text('metadata_json', { mode: 'json' })
    .$type<VersionedObject>()
    .notNull()
    .default(emptyVersionedObject),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('memory_scope_check', sql`${table.scope} IN ('user', 'agent')`),
  check('memory_kind_check', sql`${table.kind} IN ('profile', 'log', 'note')`),
  check(
    'memory_subject_check',
    sql`(${table.scope} = 'user' AND ${table.subjectAgentId} IS NULL)
      OR (${table.scope} = 'agent' AND ${table.subjectAgentId} IS NOT NULL)`,
  ),
  check('memory_metadata_json_check', sql`json_valid(${table.metadataJson})`),
  index('memory_scope_idx').on(table.scope, table.subjectAgentId, table.createdAt),
])

export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  serverKey: text('server_key').notNull().unique(),
  name: text('name').notNull(),
  transport: text('transport').notNull(),
  configurationJson: text('configuration_json', { mode: 'json' })
    .$type<VersionedObject>()
    .notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('mcp_servers_configuration_json_check', sql`json_valid(${table.configurationJson})`),
])

export const mcpAccounts = sqliteTable('mcp_accounts', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  authType: text('auth_type').notNull(),
  credentialsJson: text('credentials_json', { mode: 'json' })
    .$type<McpCredentials>()
    .notNull(),
  tokenExpiresAt: integer('token_expires_at'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('mcp_accounts_auth_type_check', sql`${table.authType} IN ('api_key', 'oauth')`),
  check('mcp_accounts_credentials_json_check', sql`json_valid(${table.credentialsJson})`),
  uniqueIndex('mcp_accounts_server_label_unique').on(table.serverId, table.label),
  index('mcp_accounts_server_idx').on(table.serverId),
])

export const agentMcpAccounts = sqliteTable('agent_mcp_accounts', {
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  accountId: text('account_id')
    .notNull()
    .references(() => mcpAccounts.id, { onDelete: 'cascade' }),
  enabledAt: integer('enabled_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.accountId] }),
  index('agent_mcp_accounts_account_idx').on(table.accountId),
])

export type ManagedFile = typeof managedFiles.$inferSelect
export type NewManagedFile = typeof managedFiles.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type Group = typeof groups.$inferSelect
export type NewGroup = typeof groups.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type ConversationCheckpoint = typeof conversationCheckpoints.$inferSelect
export type NewConversationCheckpoint = typeof conversationCheckpoints.$inferInsert
export type Turn = typeof turns.$inferSelect
export type NewTurn = typeof turns.$inferInsert
export type ConversationMessage = typeof conversationMessages.$inferSelect
export type NewConversationMessage = typeof conversationMessages.$inferInsert
export type MemoryItem = typeof memoryItems.$inferSelect
export type NewMemoryItem = typeof memoryItems.$inferInsert
export type McpServer = typeof mcpServers.$inferSelect
export type NewMcpServer = typeof mcpServers.$inferInsert
export type McpAccount = typeof mcpAccounts.$inferSelect
export type NewMcpAccount = typeof mcpAccounts.$inferInsert
