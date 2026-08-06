import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../foundation'

export interface CaptionProps extends ComponentPropsWithoutRef<'span'> {
  tone?: 'default' | 'muted'
}

export function Caption({ className, tone = 'muted', ...props }: CaptionProps) {
  return (
    <span
      className={cn(
        'text-xs leading-none',
        tone === 'muted'
          ? 'text-slate-500 dark:text-slate-400'
          : 'text-slate-900 dark:text-slate-100',
        className
      )}
      {...props}
    />
  )
}
