import { variants } from '../foundation'

export const headingVariants = variants({
  base: 'font-semibold tracking-tight text-slate-900 dark:text-slate-100',

  variants: {
    level: {
      h1: 'text-4xl',
      h2: 'text-3xl',
      h3: 'text-2xl',
      h4: 'text-xl',
      h5: 'text-lg',
      h6: 'text-base',
    },

    tone: {
      default: 'text-slate-900 dark:text-slate-100',
      muted: 'text-slate-500 dark:text-slate-400',
    },
  },

  defaultVariants: {
    level: 'h2',
    tone: 'default',
  },
})
