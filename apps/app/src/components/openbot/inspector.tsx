import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { BotAvatar } from './bot-avatar'
import { pluginById, type Bot, type Conversation } from './data'

export function Inspector({
  conversation,
  bot,
  onOpenPlugins,
}: {
  conversation: Conversation
  bot: Bot
  onOpenPlugins: () => void
}) {
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState(bot.memory)

  const accounts = bot.grants
    .map(([pluginId, accountId]) => {
      const plugin = pluginById(pluginId)
      const account = plugin?.accounts.find((a) => a.id === accountId)
      return plugin && account ? { plugin, account } : null
    })
    .filter((x) => x !== null)

  return (
    <aside className="flex w-78 shrink-0 flex-col gap-5.5 overflow-y-auto border-l bg-sidebar/70 px-3.5 py-4">
      {/* Live view */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold text-muted-foreground">Live View</h3>
        <div className="flex h-36 cursor-zoom-in items-end rounded-lg border bg-[repeating-linear-gradient(115deg,transparent_0_9px,oklch(1_0_0/3%)_9px_18px)] p-2.5 hover:border-foreground/20">
          <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[10px] text-muted-foreground">
            {conversation.title} · screen
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-xs text-muted-foreground">Shared machine</span>
        </div>
      </section>

      {/* Accounts */}
      <section>
        <div className="mb-2 flex items-center">
          <h3 className="flex-1 text-[11px] font-semibold text-muted-foreground">Accounts</h3>
          <button
            type="button"
            onClick={onOpenPlugins}
            className="text-xs font-medium text-info hover:opacity-80"
          >
            Manage
          </button>
        </div>
        {accounts.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            {accounts.map(({ plugin, account }) => (
              <div
                key={plugin.id + account.id}
                className="flex items-center gap-2 border-b bg-card px-2.5 py-2 last:border-b-0"
              >
                <BotAvatar
                  name={plugin.name}
                  color={plugin.hue}
                  className="size-5 rounded-sm text-[9px]"
                />
                <span className="min-w-0 flex-1 truncate text-xs">{plugin.name}</span>
                <span className="text-[11px] text-muted-foreground">{account.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70">No accounts scoped to this bot.</p>
        )}
      </section>

      {/* Memory */}
      <section>
        <div className="mb-2 flex items-center">
          <h3 className="flex-1 text-[11px] font-semibold text-muted-foreground">Memory</h3>
          <button
            type="button"
            onClick={() => setMemoryOpen(true)}
            className="text-xs font-medium text-info hover:opacity-80"
          >
            View / Edit
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMemoryOpen(true)}
          className="w-full rounded-lg border bg-card px-3 py-2.5 text-left hover:border-foreground/20"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <FileText className="size-3 text-muted-foreground" />
            <span className="font-mono text-[11px] font-semibold text-foreground/80">
              memory.md
            </span>
          </div>
          <div className="line-clamp-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {bot.memory}
          </div>
        </button>
        <p className="mt-1.5 text-[10px] leading-normal text-muted-foreground/70">
          Maintained by the bot. Shared across all its conversations.
        </p>
      </section>

      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2.5">
              <span className="flex-1">Memory — {bot.name}</span>
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/70">
                MARKDOWN
              </span>
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={memoryDraft}
            onChange={(e) => setMemoryDraft(e.target.value)}
            className="min-h-60 font-mono text-xs leading-relaxed"
          />
          <DialogFooter className="items-center">
            <span className="mr-auto text-[11px] text-muted-foreground/70">
              Maintained by the bot. Shared across all its conversations.
            </span>
            <Button variant="secondary" size="sm" onClick={() => setMemoryOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setMemoryOpen(false)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
