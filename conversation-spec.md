# Conversation UI Spec

Compact implementation spec for the reconstructed Grok Bot conversation UI.
This describes repository evidence only; do not add behavior not listed here.

## Stack

- React 19.
- Tiptap 3: `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-mention`, `@tiptap/extension-placeholder`, `@tiptap/suggestion`.
- `@floating-ui/dom`, `@base-ui/react`, `@tiptap/*`, `katex`, `mermaid`, `emojibase-data`, `react-hotkeys-hook`.


## Transcript Messages

Render separate rows for:

- User messages.
- Agent messages.
- Streaming agent messages.
- Agent/group member messages with author identity.
- Attachments and media galleries.
- Structured `send-message` cards: text, links, widgets, connector cards, drafts, secrets, permissions, cloud-agent cards, and related cards present in the transcript protocol.
- Timeline/notice/automation events.
- Thinking rows and tool-call rows where activity data is present.

Message rows expose author and timestamp through accessible labels. Group adjacent messages with `data-group-start`.

## Agent Text Rendering

`AgentMessageContent` custom-renders:

- Paragraphs.
- Headings level 1-3.
- Ordered/unordered lists and task-list markers.
- Blockquotes.
- Horizontal rules.
- Pipe tables.
- Fenced code blocks with copy-code action.
- Inline bold, italic, strikethrough, inline code, and HTTP(S) links.
- `\\(...\\)` inline math and `$$...$$` display math through dynamically loaded KaTeX.
- Mermaid fenced blocks through the Mermaid viewer.
- Optional agent images and channel tag.

User rich text is restored from Tiptap JSON and renders paragraphs, headings, lists, blockquotes, code blocks, hard breaks, links, mentions, workflow references, and PR references. Malformed rich text falls back to plain text.

## Tool/Activity Displays

- Tool calls are compact rows/cards, not terminal-first output.
- Rows show formatted tool name, one-line preview/summary, and status icon.
- Status icons: loading/pending, wrench/success, `x-circle`/failed.
- Clicking a row expands/collapses details.
- Empty detail displays `No additional details.`
- Tool-result cards use native `<details>`, show kind/path/command/status, and expandable output/diff/working directory.
- Tool output is bounded in a scrollable preformatted region.
- Thinking and tool activity are primarily exposed in the `Full conversation` panel.

## Message Hover/Action UI

For eligible delivered, non-pending messages, show actions on hover, focus, or context menu. Toolbar label:

`Message actions for <author> (<entry-id>)`

Actions:

- Add reaction.
- Reply to your message / Reply to `<agent>` message.
- More message actions.
- Start a thread for top-level entries.
- Copy when ordinary text is copyable.

Do not intercept context menus on links, images, form fields, contenteditable content, or active selections. Escape closes the menu and restores focus.

Copy is unavailable for URLs, attachment paths, and structured payloads. Failed/queued messages expose their own resend/delete/cancel controls instead.

## Replies and Threads

- Reply selects a stable entry ID and shows a composer reply pill.
- Reply placeholders vary by target: `Reply…`, `Reply to attachment…`, `Reply to file…`, or `Reply to link…`.
- Reply quotes show a preview and jump/open-thread behavior.
- Missing targets display `(deleted)`.
- Start a thread opens a root-scoped thread; nested thread creation is unavailable.
- Thread roots show `View thread`, `1 reply`, or `<N> replies`.
- Thread transcript, send, reactions, and read-only state are scoped to the root ID.

## Reactions

- Add reaction opens quick emoji plus `More emoji`.
- Buttons use `aria-pressed` and `React with <emoji>`/`Remove <emoji> reaction`.
- Pills preserve first-seen emoji order and show a count only above one.
- Tooltips/labels expose `You` and resolved reactor names.
- User reactions update optimistically, then reconcile with the authoritative event; failure rolls back.
- Clicking the current user's pill toggles their reaction.
- Agent `ReactToMessage` targets only user messages using their `[t3u]` address and toggles the same emoji.
- A user reaction to an agent message may wake the agent with a hidden prompt; no reply is required.

## Waiting and Error States

- Streaming empty agent content shows a three-dot typing indicator.
- Running agent/group state shows `Working` in the header/sidebar and animated avatar state.
- Queued send: `Waiting to send…`, with Cancel when available.
- Offline queued send: `Will send when reconnected`.
- Failed send: `Failed to send`, with Resend/Delete when available.
- Voice states: `Listening…`, recording timer/waveform, `Transcribing…`, and bounded error text.
- Do not expose internal checkpoints as normal transcript UI.

## Groups

- Group messages remain separate messages with member author/avatar identity.
- Group avatar is composed from member avatars, with `+N` for additional members.
- The primary group chat has generic group-level working/typing state, not a distinct in-chat “agent X is working” row for every silent member.
- Individual working states may appear in sidebar/org-chart surfaces.
- Group member tool/message activity can be represented in the transcript and full-conversation activity view.

## Full Conversation

Movable dialog titled `Full conversation: <agent>`.

- Root tab uses the agent name or `Conversation`.
- Subagent tabs use `<type>: <title>` and running/done/error/aborted markers.
- Items: You, Thinking, Agent, Message, and tool-call rows.
- Tool rows show pending/success/failure icons.
- Rows expand to full text or summary.
- Activity follows appended entries; running subagent data refreshes every two seconds.
- Empty state: `No conversation activity yet.`
- Escape closes; header is draggable.

## Markdown rendering 

use what's better `react-markdown`, remark or rehype to support only:
 
Block syntax
- Paragraphs.
- Headings level 1-3: #, ##, ###.
- Unordered lists: -, +, *.
- Ordered lists: 1., 2., etc.
- Task-list markers: [ ] and [x], rendered read-only.
- Blockquotes: >.
- Horizontal rules: ---, ***, ___.
- Pipe tables with a separator row.
- Fenced code blocks: ````` ``.
- Mermaid fenced blocks, rendered by the Mermaid viewer.
- Display math delimited by $$.
Inline syntax
- Bold: **text** or __text__.
- Italic: *text* or _text_.
- Strikethrough: ~~text~~.
- Inline code:  `code` .
- Markdown links with HTTP(S) URLs.
- Raw HTTP(S) URLs.
- Inline math: \(expression\).
Additional content
- Agent-provided images.
- A channel tag when the message was sent through a channel.
- Code blocks have a Copy code button.
- Math is rendered using dynamically loaded KaTeX.
- Mermaid diagrams are rendered using dynamically loaded Mermaid.

## Composer

The composer contains a Tiptap editor, reply pill, attachments, voice controls, and send controls. It has no formatting toolbar, selection bubble, or explicit formatting button.

Enabled editor behavior:

- Paragraphs, text, hard breaks, links, placeholder, undo/redo.
- Conditional `@` member/workflow/MCP suggestions.
- Conditional `/` workflow/action references.
- Conditional `#` pull-request references, maximum eight displayed candidates.
- Conditional `:` emoji suggestions; query requires two characters and supports `a-z`, digits, `_`, `+`, `-`.
- No generic slash-command framework.
- `Enter` submits; `Shift+Enter` inserts a line break.
- `Escape` cancels voice/refocuses or blurs the editor.
- macOS `Ctrl+A`/`Ctrl+E` moves to line start/end; Shift extends selection.
- Suggestion menus: Up/Down navigate, Enter/Tab select, Escape dismisses.
- `Cmd/Ctrl+V` outside the editor focuses it and inserts clipboard text; files are staged.

The composer explicitly disables StarterKit bold, italic, strike, blockquote, lists, headings, horizontal rules, inline code, and code blocks. It therefore has no authoring controls for those features.

Attachments support picker, paste, and drag-and-drop, with a maximum of six. Each attachment can be removed. The draft stores plain `prompt`, optional Tiptap `richText`, attachments, optional `replyToId`, and optional `isFork` in client-persisted, account-sensitive state.
