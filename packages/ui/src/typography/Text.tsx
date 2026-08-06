import type { ComponentPropsWithoutRef } from 'react'
import { cn, type VariantProps } from '../foundation'
import { textVariants } from './text.variants'

export interface TextProps
  extends ComponentPropsWithoutRef<'p'>, VariantProps<typeof textVariants> {}

export function Text({ className, size, weight, tone, ...props }: TextProps) {
  return (
    <p
      className={cn(
        textVariants({
          size,
          weight,
          tone,
        }),
        className
      )}
      {...props}
    />
  )
}
