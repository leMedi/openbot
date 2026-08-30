import { cn } from '@/lib/utils'
import { avatarShapePath, initialOf } from './data'

export function BotAvatar({
  name,
  color,
  shape,
  src,
  className,
}: {
  name: string
  color: string
  /** Avatar shape id (see AVATAR_SHAPES); when set, renders the shaped avatar. */
  shape?: string
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
  if (shape) {
    return (
      <div
        className={cn(
          'relative flex size-7 shrink-0 items-center justify-center text-xs font-semibold',
          color === '#f2f2f2' ? 'text-muted-foreground' : 'text-white',
          className,
        )}
      >
        <svg viewBox="0 0 48 48" className="absolute inset-0 size-full">
          <path d={avatarShapePath(shape)} fill={color} />
        </svg>
        <span className="relative">{initialOf(name)}</span>
      </div>
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
