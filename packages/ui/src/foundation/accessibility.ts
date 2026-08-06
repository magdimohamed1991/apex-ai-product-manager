/**
 * Accessibility defaults for all interactive components.
 */

export const accessibility = {
  focusVisibleClass:
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',

  disabledClass: 'disabled:pointer-events-none disabled:opacity-50',

  interactiveClass: 'select-none touch-manipulation',
} as const
