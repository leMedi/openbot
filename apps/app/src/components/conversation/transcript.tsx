import { MessageRow, ThinkingRow, TimelineRow, ToolEntryRow } from './rows'
import type { MessageRowHandlers } from './rows'
import type { Entry } from './types'

/** True when the entry starts a new visual group of adjacent same-author messages. */
function isGroupStart(entries: Entry[], index: number) {
  const entry = entries[index]
  if (entry.type !== 'message') return true
  const prev = entries[index - 1]
  if (!prev || prev.type !== 'message') return true
  return prev.author.id !== entry.author.id
}

export function Transcript({
  entries,
  handlers,
  inThread,
  oneToOne,
  readOnly,
}: {
  entries: Entry[]
  handlers: MessageRowHandlers
  inThread?: boolean
  oneToOne?: boolean
  readOnly?: boolean
}) {
  return (
    <div className="flex flex-col">
      {entries.map((entry, i) => {
        switch (entry.type) {
          case 'timeline':
            return <TimelineRow key={entry.id} entry={entry} />
          case 'thinking':
            return <ThinkingRow key={entry.id} entry={entry} />
          case 'tool':
            return <ToolEntryRow key={entry.id} entry={entry} />
          case 'message':
            return (
              <MessageRow
                key={entry.id}
                entry={entry}
                groupStart={isGroupStart(entries, i)}
                inThread={inThread}
                oneToOne={oneToOne}
                readOnly={readOnly}
                handlers={handlers}
              />
            )
        }
      })}
    </div>
  )
}
