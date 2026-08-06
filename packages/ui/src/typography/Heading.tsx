import type { ComponentPropsWithoutRef } from 'react'
import { cn, type VariantProps } from '../foundation'
import { headingVariants } from './heading.variants'

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface HeadingProps
  extends ComponentPropsWithoutRef<HeadingLevel>, VariantProps<typeof headingVariants> {
  as?: HeadingLevel
}

export function Heading({ as, className, level, tone, ...props }: HeadingProps) {
  const Tag = as ?? level ?? 'h2'

  return <Tag className={cn(headingVariants({ level, tone }), className)} {...props} />
}
