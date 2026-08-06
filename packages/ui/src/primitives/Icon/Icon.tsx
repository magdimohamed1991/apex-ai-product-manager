import type { LucideIcon, LucideProps } from 'lucide-react'
import { cn } from '../../foundation'
import { DEFAULT_ICON_SIZE } from '../../foundation'

export interface IconProps extends LucideProps {
  icon: LucideIcon
}

export function Icon({ icon: LucideIconComponent, className, size, ...props }: IconProps) {
  return (
    <LucideIconComponent
      size={size ?? DEFAULT_ICON_SIZE}
      className={cn('shrink-0', className)}
      aria-hidden="true"
      {...props}
    />
  )
}
