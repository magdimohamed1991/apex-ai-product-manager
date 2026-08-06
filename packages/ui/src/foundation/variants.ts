import { tv, type VariantProps } from 'tailwind-variants'

/**
 * APEX Variants Engine
 *
 * Single abstraction over tailwind-variants.
 * Never import `tv` directly in components.
 */
export const variants = tv

export type { VariantProps }
