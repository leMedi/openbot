import { cn } from '@/lib/utils'
import { initialOf } from './data'

export function BotAvatar({
  name,
  color,
  src,
  className,
}: {
  name: string
  color: string
  src?: string
  className?: string
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('size-7 shrink-0 rounded-md object-cover', className)}
      />
    )
  }
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
