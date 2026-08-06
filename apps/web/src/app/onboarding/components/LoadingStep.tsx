import { useEffect, useState } from 'react'
import { LOADING_TASKS } from '../constants'

interface LoadingStepProps {
  onComplete: () => void
}

export function LoadingStep({ onComplete }: LoadingStepProps) {
  const [completedTasks, setCompletedTasks] = useState<number>(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const totalDuration = 6000
    const taskInterval = totalDuration / LOADING_TASKS.length

    const taskTimer = setInterval(() => {
      setCompletedTasks((prev) => {
        const next = prev + 1
        if (next >= LOADING_TASKS.length) {
          clearInterval(taskTimer)
          setTimeout(onComplete, 800)
        }
        return next
      })
    }, taskInterval)

    const progressTimer = setInterval(() => {
      setProgress((prev) => Math.min(prev + 1, 100))
    }, totalDuration / 100)

    return () => {
      clearInterval(taskTimer)
      clearInterval(progressTimer)
    }
  }, [onComplete])

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/10 ring-1 ring-indigo-500/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-white">Creating your AI Workspace</h2>
          <p className="mt-1 text-slate-400">This will only take a moment...</p>
        </div>
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-between text-xs text-slate-500">
          <span>Setting up APEX</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        {LOADING_TASKS.map((task, index) => {
          const isDone = index < completedTasks
          const isCurrent = index === completedTasks

          return (
            <div key={task} className="flex items-center gap-3 text-left">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isDone ? (
                  <span className="text-sm text-emerald-400">✓</span>
                ) : isCurrent ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-slate-600 border-t-indigo-400" />
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                )}
              </div>
              <span
                className={
                  isDone
                    ? 'text-sm text-slate-400 line-through'
                    : isCurrent
                      ? 'text-sm text-white'
                      : 'text-sm text-slate-600'
                }
              >
                {task}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
