import { useMemo, useState } from 'react'
import type { ModelDto } from '@openbot/agent'
import { sortProviders } from '@openbot/plugins/provider-icons'
import { ChevronsUpDown } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ProviderBrandIcon } from './provider-brand-icon'

export function ModelPicker({
  value,
  models,
  onChange,
  emptyLabel,
  placeholder = 'Choose a model',
  disabled,
  className,
}: {
  value: string
  models: ModelDto[]
  onChange: (value: string) => void
  /** When set, an empty value is allowed and shown with this label as the first choice. */
  emptyLabel?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const byProvider = new Map<string, { id: string; name: string; models: ModelDto[] }>()
    for (const model of models) {
      const group = byProvider.get(model.provider)
        ?? { id: model.provider, name: model.providerName, models: [] }
      group.models.push(model)
      byProvider.set(model.provider, group)
    }
    return sortProviders([...byProvider.values()]).map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
  }, [models])

  const selected = models.find((model) => model.key === value)
  const unavailable = !!value && !selected

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
          className,
        )}
      >
        {selected ? (
          <>
            <ProviderBrandIcon
              plain
              provider={{ id: selected.provider, name: selected.providerName }}
              className="opacity-60"
            />
            <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          </>
        ) : unavailable ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{value} (unavailable)</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {emptyLabel ?? placeholder}
          </span>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command className="bg-transparent">
          <CommandInput placeholder="Search models…" autoFocus />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No models match</CommandEmpty>
            {emptyLabel && (
              <CommandGroup>
                <CommandItem value={`__default ${emptyLabel}`} onSelect={() => pick('')}>
                  <span className="truncate text-sm text-muted-foreground">{emptyLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((group) => (
              <CommandGroup key={group.id} heading={group.name}>
                {group.models.map((model) => (
                  <CommandItem
                    key={model.key}
                    value={`${model.providerName} ${model.name} ${model.key}`}
                    data-checked={model.key === value || undefined}
                    onSelect={() => pick(model.key)}
                  >
                    <ProviderBrandIcon
                      plain
                      provider={{ id: group.id, name: group.name }}
                      className="opacity-50"
                    />
                    <span className="truncate text-sm">{model.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
