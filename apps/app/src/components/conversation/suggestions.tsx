// Suggestion menus for the composer: `@` members/workflows/MCP, `/` workflows,
// `#` PR references (max 8), `:` emoji (2+ chars). Up/Down navigate,
// Enter/Tab select, Escape dismisses.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { AtSign, Hash, Plug, SmilePlus, Workflow, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MENTION_ITEMS, PR_ITEMS, WORKFLOW_ITEMS } from './data'

export type SuggestionItem = {
  id: string
  label: string
  kind?: string
  /** For emoji items, the character to insert. */
  emoji?: string
}

/** Non-zero while any suggestion menu is open — lets Enter-to-send yield. */
export let activeSuggestions = 0

function kindIcon(kind?: string) {
  switch (kind) {
    case 'member':
      return <AtSign className="size-3 text-info" />
    case 'workflow':
      return <Workflow className="size-3 text-success" />
    case 'action':
      return <Zap className="size-3 text-warning" />
    case 'mcp':
      return <Plug className="size-3 text-muted-foreground" />
    case 'pr':
      return <Hash className="size-3 text-info" />
    case 'emoji':
      return <SmilePlus className="size-3 text-muted-foreground" />
    default:
      return null
  }
}

type ListProps = {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
}

export type SuggestionListRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const SuggestionList = forwardRef<SuggestionListRef, ListProps>(function SuggestionList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (items[selected]) command(items[selected])
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null
  return (
    <div className="w-60 rounded-lg border bg-popover p-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(i)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            i === selected && 'bg-accent text-accent-foreground',
          )}
        >
          {item.emoji ? <span className="text-sm">{item.emoji}</span> : kindIcon(item.kind)}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.kind && !item.emoji && (
            <span
              className={cn(
                'text-[9px] font-semibold tracking-wider uppercase',
                i === selected ? 'text-accent-foreground/70' : 'text-muted-foreground/70',
              )}
            >
              {item.kind}
            </span>
          )}
        </button>
      ))}
    </div>
  )
})

/** Shared popup renderer positioned with @floating-ui/dom. */
export function suggestionRender(): ReturnType<
  NonNullable<SuggestionOptions<SuggestionItem>['render']>
> {
  let component: ReactRenderer<SuggestionListRef, ListProps> | null = null

  async function place(props: SuggestionProps<SuggestionItem>) {
    if (!component) return
    const el = component.element as HTMLElement
    const rect = props.clientRect?.()
    if (!rect) return
    const virtual = { getBoundingClientRect: () => rect }
    const { x, y } = await computePosition(virtual, el, {
      placement: 'top-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    })
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` })
  }

  return {
    onStart(props) {
      activeSuggestions += 1
      component = new ReactRenderer(SuggestionList, {
        props: { items: props.items, command: props.command },
        editor: props.editor,
      })
      const el = component.element as HTMLElement
      el.style.position = 'fixed'
      el.style.zIndex = '80'
      document.body.appendChild(el)
      place(props)
    },
    onUpdate(props) {
      component?.updateProps({ items: props.items, command: props.command })
      place(props)
    },
    onKeyDown(props) {
      if (props.event.key === 'Escape') return false // suggestion plugin exits
      return component?.ref?.onKeyDown(props) ?? false
    },
    onExit() {
      activeSuggestions = Math.max(0, activeSuggestions - 1)
      component?.element.remove()
      component?.destroy()
      component = null
    },
  }
}

function match(query: string, label: string) {
  return label.toLowerCase().includes(query.toLowerCase())
}

export function mentionItems({ query }: { query: string }): SuggestionItem[] {
  return MENTION_ITEMS.filter((i) => match(query, i.label)).slice(0, 8)
}

export function workflowItems({ query }: { query: string }): SuggestionItem[] {
  return WORKFLOW_ITEMS.filter((i) => match(query, i.label)).slice(0, 8)
}

/** Pull-request references — maximum eight displayed candidates. */
export function prItems({ query }: { query: string }): SuggestionItem[] {
  return PR_ITEMS.filter((i) => match(query, `${i.id} ${i.label}`))
    .slice(0, 8)
    .map((i) => ({ id: i.id, label: `#${i.id} ${i.label}`, kind: 'pr' }))
}

type EmojiRecord = { emoji: string; shortcode: string }
let emojiIndex: EmojiRecord[] | null = null

async function loadEmoji(): Promise<EmojiRecord[]> {
  if (emojiIndex) return emojiIndex
  const [data, shortcodes] = await Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/emojibase.json'),
  ])
  const codes = shortcodes.default as Record<string, string | string[]>
  emojiIndex = (data.default as { hexcode: string; unicode: string }[]).flatMap((e) => {
    const sc = codes[e.hexcode]
    if (!sc) return []
    const first = Array.isArray(sc) ? sc[0] : sc
    return [{ emoji: e.unicode, shortcode: first }]
  })
  return emojiIndex
}

/** `:` emoji suggestions; query requires 2+ chars of `a-z`, digits, `_`, `+`, `-`. */
export async function emojiItems({ query }: { query: string }): Promise<SuggestionItem[]> {
  if (!/^[a-z0-9_+-]{2,}$/.test(query)) return []
  const all = await loadEmoji()
  return all
    .filter((e) => e.shortcode.includes(query.toLowerCase()))
    .slice(0, 8)
    .map((e) => ({ id: e.shortcode, label: `:${e.shortcode}:`, emoji: e.emoji, kind: 'emoji' }))
}
