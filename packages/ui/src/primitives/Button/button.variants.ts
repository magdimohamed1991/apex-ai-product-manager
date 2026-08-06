import { variants } from '../../foundation'

export const buttonVariants = variants({
  base: [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium',
    'transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none touch-manipulation',
  ],

  variants: {
    variant: {
      default: 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800',
      secondary:
        'bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
      outline:
        'border border-slate-200 bg-transparent text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800',
      ghost:
        'bg-transparent text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800',
      danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
    },

    size: {
      sm: 'h-8 px-3 text-xs',
      md: 'h-9 px-4 text-sm',
      lg: 'h-10 px-5 text-base',
      icon: 'h-9 w-9 p-0',
    },
  },

  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
})
