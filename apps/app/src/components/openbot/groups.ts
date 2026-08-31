// Maps persisted groups (@openbot/db rows, fetched through server functions)
// onto the UI's Bot view model so shared group rooms render through the same
// sidebar and conversation surfaces as single agents.

import type { Group } from '@openbot/db'
import type { Bot } from './data'

// Groups have no per-group shape/color columns; a fixed look distinguishes
// rooms from agents until composed member avatars land.
export const GROUP_AVATAR_COLOR = '#3f8f8a'
export const GROUP_AVATAR_SHAPE = 'hexagon'

export function groupAvatarUrl(group: Group) {
  if (!group.avatarFileId) return undefined
  return `/api/groups/${group.id}/avatar?v=${encodeURIComponent(group.avatarFileId)}`
}

export function groupMemberIds(group: Group) {
  return group.membersJson.members
    .filter((m) => m.type === 'agent')
    .map((m) => m.agentId)
}

export function botFromGroup(group: Group): Bot {
  return {
    id: group.id,
    name: group.name,
    color: GROUP_AVATAR_COLOR,
    shape: GROUP_AVATAR_SHAPE,
    model: '',
    prompt: group.description,
    grants: [],
    memory: '',
    avatarUrl: groupAvatarUrl(group),
    kind: 'group',
  }
}
