import { useEffect, useMemo, useRef, useState } from 'react'
import { Extension } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Suggestion from '@tiptap/suggestion'
import { ArrowUp, FileText, Loader2, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  activeSuggestions,
  emojiItems,
  mentionItems,
  prItems,
  suggestionRender,
  workflowItems,
  type SuggestionItem,
} from './suggestions'
import type { Attachment, Draft, Entry, VoiceState } from './types'

const MAX_ATTACHMENTS = 6
// Client-persisted, account-sensitive draft storage.
const draftKey = (scope: string) => `openbot:conversation-draft:acct-mehdi:${scope}`

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

function lineEdge(editor: Editor, edge: 'start' | 'end', extend: boolean) {
  const { state, view } = editor
  const sel = state.selection
  const pos = edge === 'start' ? sel.$head.start() : sel.$head.end()
  const next = extend
    ? TextSelection.create(state.doc, sel.anchor, pos)
    : TextSelection.create(state.doc, pos)
  view.dispatch(state.tr.setSelection(next).scrollIntoView())
  return true
}

function replyPlaceholder(target: Entry | undefined) {
  if (!target || target.type !== 'message') return 'Reply…'
  if (target.attachments?.some((a) => a.kind === 'image')) return 'Reply to attachment…'
  if (target.attachments?.some((a) => a.kind === 'file')) return 'Reply to file…'
  if (
    target.cards?.some((c) => c.kind === 'links') ||
    /https?:\/\//.test(target.text ?? target.markdown ?? '')
  )
    return 'Reply to link…'
  return 'Reply…'
}

export function Composer({
  agentName,
  replyTo,
  onCancelReply,
  onJumpToReply,
  onSend,
  findEntry,
  compact,
  draftScope = 'main',
}: {
  agentName: string
  replyTo?: string
  onCancelReply: () => void
  onJumpToReply?: (id: string) => void
  onSend: (draft: Draft) => void
  findEntry: (id: string) => Entry | undefined
  compact?: boolean
  draftScope?: string
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [voice, setVoice] = useState<VoiceState>({ phase: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const replyTarget = replyTo ? findEntry(replyTo) : undefined
  const placeholderRef = useRef('')
  placeholderRef.current = replyTo
    ? replyPlaceholder(replyTarget)
    : `Message ${agentName}`

  const submitRef = useRef<() => void>(() => {})
  const escapeRef = useRef<() => void>(() => {})

  const extensions = useMemo(() => {
    const keys = Extension.create({
      name: 'composerKeys',
      priority: 1000,
      addKeyboardShortcuts() {
        const shortcuts: Record<string, () => boolean> = {
          Enter: () => {
            if (activeSuggestions > 0) return false
            submitRef.current()
            return true
          },
          'Shift-Enter': () => this.editor.commands.setHardBreak(),
          Escape: () => {
            escapeRef.current()
            return true
          },
        }
        if (isMac) {
          shortcuts['Ctrl-a'] = () => lineEdge(this.editor, 'start', false)
          shortcuts['Ctrl-e'] = () => lineEdge(this.editor, 'end', false)
          shortcuts['Shift-Ctrl-a'] = () => lineEdge(this.editor, 'start', true)
          shortcuts['Shift-Ctrl-e'] = () => lineEdge(this.editor, 'end', true)
        }
        return shortcuts
      },
    })

    const emoji = Extension.create({
      name: 'emojiSuggestion',
      addProseMirrorPlugins() {
        return [
          Suggestion<SuggestionItem>({
            editor: this.editor,
            char: ':',
            pluginKey: new PluginKey('emojiSuggestion'),
            items: emojiItems,
            command: ({ editor, range, props }) => {
              editor
                .chain()
                .focus()
                .insertContentAt(range, `${props.emoji ?? ''} `)
                .run()
            },
            render: suggestionRender,
          }),
        ]
      },
    })

    return [
      // No authoring controls: bold/italic/strike/blockquote/lists/headings/
      // rules/inline code/code blocks are disabled.
      StarterKit.configure({
        bold: false,
        italic: false,
        strike: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        heading: false,
        horizontalRule: false,
        code: false,
        codeBlock: false,
        underline: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Mention.extend({ name: 'mention' }).configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          char: '@',
          pluginKey: new PluginKey('memberMention'),
          items: mentionItems,
          render: suggestionRender,
        },
      }),
      Mention.extend({ name: 'workflowRef' }).configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          char: '/',
          pluginKey: new PluginKey('workflowRef'),
          items: workflowItems,
          render: suggestionRender,
        },
      }),
      Mention.extend({ name: 'prRef' }).configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          char: '#',
          pluginKey: new PluginKey('prRef'),
          items: prItems,
          render: suggestionRender,
        },
      }),
      keys,
      emoji,
    ]
  }, [])

  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-9 max-h-40 overflow-y-auto px-1 py-2 text-sm',
        'aria-label': 'Message composer',
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length > 0) {
          stageFiles(files)
          return true
        }
        return false
      },
    },
  })

  // Restore persisted draft; malformed rich text falls back to plain prompt.
  useEffect(() => {
    if (!editor) return
    try {
      const raw = localStorage.getItem(draftKey(draftScope))
      if (!raw) return
      const draft = JSON.parse(raw) as Draft
      if (draft.richText) {
        try {
          editor.commands.setContent(draft.richText as never)
        } catch {
          editor.commands.setContent(draft.prompt)
        }
      } else if (draft.prompt) {
        editor.commands.setContent(draft.prompt)
      }
      if (draft.attachments) setAttachments(draft.attachments.slice(0, MAX_ATTACHMENTS))
    } catch {
      // unreadable draft — start clean
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Persist the draft (account-sensitive, client-side).
  useEffect(() => {
    if (!editor) return
    const save = () => {
      const draft: Draft = {
        prompt: editor.getText(),
        richText: editor.getJSON(),
        attachments,
        replyToId: replyTo,
        isFork: false,
      }
      try {
        localStorage.setItem(draftKey(draftScope), JSON.stringify(draft))
      } catch {
        // storage unavailable
      }
    }
    editor.on('update', save)
    save()
    return () => {
      editor.off('update', save)
    }
  }, [editor, attachments, replyTo])

  // Refresh the placeholder decoration when the reply target changes.
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr)
  }, [editor, replyTo])

  function stageFiles(files: File[]) {
    setAttachments((current) => {
      const next = [...current]
      for (const f of files) {
        if (next.length >= MAX_ATTACHMENTS) break
        next.push({
          id: `${f.name}-${Date.now()}-${next.length}`,
          name: f.name,
          size: f.size >= 1024 ? `${Math.round(f.size / 1024)} KB` : `${f.size} B`,
          kind: f.type.startsWith('image/') ? 'image' : 'file',
        })
      }
      return next
    })
  }

  submitRef.current = () => {
    if (!editor) return
    const prompt = editor.getText().trim()
    if (!prompt && attachments.length === 0) return
    onSend({
      prompt,
      richText: editor.getJSON(),
      attachments,
      replyToId: replyTo,
      isFork: false,
    })
    editor.commands.clearContent()
    setAttachments([])
    try {
      localStorage.removeItem(draftKey(draftScope))
    } catch {
      // ignore
    }
  }

  escapeRef.current = () => {
    if (voice.phase !== 'idle') {
      setVoice({ phase: 'idle' })
      editor?.commands.focus()
    } else {
      editor?.commands.blur()
    }
  }

  // Cmd/Ctrl+V outside the editor focuses it and inserts clipboard text; files are staged.
  useEffect(() => {
    function onWindowPaste(e: ClipboardEvent) {
      const target = e.target as Element | null
      if (containerRef.current?.contains(target)) return
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) {
        stageFiles(files)
        e.preventDefault()
        return
      }
      const text = e.clipboardData?.getData('text/plain')
      if (text && editor) {
        editor.chain().focus('end').insertContent(text).run()
        e.preventDefault()
      }
    }
    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [editor])

  // Mock voice capture timer.
  useEffect(() => {
    if (voice.phase !== 'listening') return
    const t = setInterval(
      () =>
        setVoice((v) => (v.phase === 'listening' ? { ...v, seconds: v.seconds + 1 } : v)),
      1000,
    )
    return () => clearInterval(t)
  }, [voice.phase])

  function stopVoice() {
    setVoice({ phase: 'transcribing' })
    setTimeout(() => {
      editor?.chain().focus('end').insertContent('Transcribed voice note. ').run()
      setVoice({ phase: 'idle' })
    }, 1000)
  }

  const canSend = attachments.length > 0 || !!editor?.getText().trim()

  return (
    <div ref={containerRef} className={cn(!compact && 'px-4 pb-4')}>
      {replyTo && (
        <div className="flex items-center gap-2.5 rounded-t-xl border border-b-0 bg-card/60 px-3 py-2">
          <span className="w-0.5 self-stretch rounded-full bg-primary" />
          <button
            type="button"
            onClick={() => replyTarget && onJumpToReply?.(replyTo)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block text-[11px] font-bold text-info">
              {replyTarget?.type === 'message'
                ? `Replying to ${replyTarget.author.name}`
                : 'Replying'}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {replyTarget?.type === 'message'
                ? (replyTarget.text ?? replyTarget.markdown?.split('\n')[0] ?? '…')
                : '(deleted)'}
            </span>
          </button>
          <Button variant="ghost" size="icon-xs" aria-label="Cancel reply" onClick={onCancelReply}>
            <X />
          </Button>
        </div>
      )}

      {attachments.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap gap-1.5 border border-b-0 bg-card/60 px-3 py-2',
            replyTo ? '' : 'rounded-t-xl',
          )}
        >
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1"
            >
              <FileText className="size-3 text-muted-foreground" />
              <span className="max-w-40 truncate text-[11px] font-medium">{a.name}</span>
              {a.size && <span className="text-[10px] text-muted-foreground/70">{a.size}</span>}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((all) => all.filter((x) => x.id !== a.id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <span className="self-center text-[10px] text-muted-foreground/60">
            {attachments.length}/{MAX_ATTACHMENTS}
          </span>
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-1.5 border bg-background/60 p-1.5 pl-2.5',
          replyTo || attachments.length > 0 ? 'rounded-b-xl' : 'rounded-xl',
          dragOver && 'border-primary/70 bg-primary/5',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          stageFiles(Array.from(e.dataTransfer.files))
        }}
      >
        {/* Attach button hidden for now — paste and drag-and-drop still stage files. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            stageFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />

        {voice.phase === 'idle' && (
          <div className="min-w-0 flex-1 [&_.mention]:rounded-sm [&_.mention]:bg-primary/15 [&_.mention]:px-0.5 [&_.mention]:text-info [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground/70 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]">
            <EditorContent editor={editor} />
          </div>
        )}
        {voice.phase === 'listening' && (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 px-1">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            <span className="text-xs font-medium">Listening…</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              0:{String(voice.seconds).padStart(2, '0')}
            </span>
            <span className="flex flex-1 items-center gap-0.5 overflow-hidden">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="w-0.5 animate-typing-dot rounded-full bg-info"
                  style={{ height: `${5 + ((i * 7) % 12)}px`, animationDelay: `${i * 60}ms` }}
                />
              ))}
            </span>
            <Button size="icon-xs" aria-label="Stop recording" onClick={stopVoice}>
              <Square />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Cancel recording"
              onClick={() => setVoice({ phase: 'idle' })}
            >
              <X />
            </Button>
          </div>
        )}
        {voice.phase === 'transcribing' && (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Transcribing…
          </div>
        )}
        {voice.phase === 'error' && (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 px-1">
            <span className="truncate text-xs text-destructive">{voice.message}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss voice error"
              onClick={() => setVoice({ phase: 'idle' })}
            >
              <X />
            </Button>
          </div>
        )}

        {/* Voice button hidden for now; the voice states above stay wired. */}
        <Button
          size="icon-sm"
          aria-label="Send"
          onClick={() => submitRef.current()}
          className={cn(!canSend && 'bg-muted text-muted-foreground hover:bg-muted')}
        >
          <ArrowUp className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
