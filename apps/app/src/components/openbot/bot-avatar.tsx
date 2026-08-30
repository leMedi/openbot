import { cn } from '@/lib/utils'
import { initialOf } from './data'

export function BotAvatar({
  name,
  color,
  className,
}: {
  name: string
  color: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white',
        className,
      )}
      style={{ background: color }}
    >
      {initialOf(name)}
    </div>
  )
}
