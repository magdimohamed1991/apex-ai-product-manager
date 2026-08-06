import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../foundation'

export type CodeProps = ComponentPropsWithoutRef<'code'>

export function Code({ className, ...props }: CodeProps) {
  return (
    <code
      className={cn(
        'rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800',
        'dark:bg-slate-800 dark:text-slate-200',
        className
      )}
      {...props}
    />
  )
}
