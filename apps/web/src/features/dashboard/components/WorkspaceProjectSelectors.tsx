import { useState } from 'react'
import type { Workspace, Project } from '../types'

interface WorkspaceSelectorProps {
  workspaces: Workspace[]
  selected: Workspace | null
  onSelect: (ws: Workspace) => void
  onCreate: (name: string) => Promise<void>
}

export function WorkspaceSelector({
  workspaces,
  selected,
  onSelect,
  onCreate,
}: WorkspaceSelectorProps) {
  const [creating, setCreating] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-bold text-slate-400">Workspace</label>
      <select
        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={selected?.id || ''}
        onChange={(e) => {
          const ws = workspaces.find((w) => w.id === e.target.value)
          if (ws) onSelect(ws)
        }}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!creating.trim()) return
          await onCreate(creating)
          setCreating('')
        }}
        className="flex gap-2 mt-1"
      >
        <input
          type="text"
          placeholder="New Workspace..."
          className="flex-1 min-w-0 rounded-md bg-slate-800/40 border border-slate-700/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          value={creating}
          onChange={(e) => setCreating(e.target.value)}
        />
        <button
          type="submit"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Create
        </button>
      </form>
    </div>
  )
}

interface ProjectSelectorProps {
  projects: Project[]
  selected: Project | null
  onSelect: (p: Project) => void
  onCreate: (name: string) => Promise<void>
}

export function ProjectSelector({ projects, selected, onSelect, onCreate }: ProjectSelectorProps) {
  const [creating, setCreating] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-bold text-slate-400">Project</label>
      {projects.length > 0 ? (
        <select
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          value={selected?.id || ''}
          onChange={(e) => {
            const p = projects.find((p) => p.id === e.target.value)
            if (p) onSelect(p)
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-slate-500 italic">No projects found.</p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!creating.trim()) return
          await onCreate(creating)
          setCreating('')
        }}
        className="flex gap-2 mt-1"
      >
        <input
          type="text"
          placeholder="New Project..."
          className="flex-1 min-w-0 rounded-md bg-slate-800/40 border border-slate-700/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          value={creating}
          onChange={(e) => setCreating(e.target.value)}
        />
        <button
          type="submit"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Create
        </button>
      </form>
    </div>
  )
}
