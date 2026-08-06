import { variants } from '../foundation'

export const textVariants = variants({
  base: 'text-slate-900 dark:text-slate-100',

  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
    },

    weight: {
      regular: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },

    tone: {
      default: 'text-slate-900 dark:text-slate-100',
      muted: 'text-slate-500 dark:text-slate-400',
      success: 'text-emerald-600 dark:text-emerald-400',
      warning: 'text-amber-600 dark:text-amber-400',
      danger: 'text-rose-600 dark:text-rose-400',
    },
  },

  defaultVariants: {
    size: 'md',
    weight: 'regular',
    tone: 'default',
  },
})
