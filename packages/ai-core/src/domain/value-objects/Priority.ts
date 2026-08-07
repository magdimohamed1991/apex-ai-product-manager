export type Priority = 'critical' | 'high' | 'medium' | 'low'

export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_ORDER[b] - PRIORITY_ORDER[a]
}
