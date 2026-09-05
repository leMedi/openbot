import { providerBrandIcon } from '@openbot/plugins/provider-icons'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'

export function ProviderBrandIcon({
  provider,
  className,
  plain = false,
}: {
  provider: { id: string; name: string }
  className?: string
  /** Render the bare mark without a tile, for inline use next to text. */
  plain?: boolean
}) {
  const icon = providerBrandIcon(provider.id)
  if (!icon) {
    return (
      <BotAvatar
        name={provider.name}
        color={providerHue(provider.id)}
        className={cn(plain ? 'size-3.5 text-[7px]' : 'size-6.5 text-xs', className)}
      />
    )
  }
  const mark = (
    <svg viewBox="0 0 24 24" role="img" aria-label={`${provider.name} logo`} className="size-full">
      <path d={icon.path} fill={icon.color} />
    </svg>
  )
  if (plain) return <span className={cn('inline-flex size-3.5 shrink-0', className)}>{mark}</span>
  return (
    <span
      className={cn(
        'flex size-6.5 shrink-0 items-center justify-center rounded-md border bg-muted/60 p-1.25',
        className,
      )}
    >
      {mark}
    </span>
  )
}

export function providerHue(providerId: string) {
  let hash = 0
  for (const character of providerId) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 42% 48%)`
}
