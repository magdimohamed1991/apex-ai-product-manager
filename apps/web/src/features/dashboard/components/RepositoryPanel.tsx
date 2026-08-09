import { useState } from 'react'
import type { RepositoryConnection, Workspace } from '../types'
import { apiClient } from '../api/client'

interface Props {
  workspace: Workspace | null
  projectId: string | null
  connection: RepositoryConnection | null
  onConnectionChange: (conn: RepositoryConnection) => void
}

export function RepositoryPanel({ workspace, projectId, connection, onConnectionChange }: Props) {
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)

  if (!workspace || !projectId) return null

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!workspace || !projectId || !owner.trim() || !name.trim()) return
    setBusy(true)
    try {
      const conn = await apiClient.connectRepository(workspace.id, projectId, {
        provider: 'github',
        owner,
        repository: name,
        defaultBranch: branch,
      })
      onConnectionChange(conn)
      setOwner('')
      setName('')
    } finally {
      setBusy(false)
    }
  }

  if (connection && connection.status === 'connected') {
    return (
      <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex flex-col text-right">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Linked Repository
          </span>
          <span className="text-sm font-bold text-white">
            {connection.owner}/{connection.repository}
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          🟢 Connected
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-8 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4 mt-12">
      <span className="text-4xl">🐙</span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-white">Connect GitHub Repository</h2>
        <p className="text-sm text-slate-400 max-w-md">
          Connect your code repository to let APEX inspect its static composition and generate
          tailored recommendations.
        </p>
      </div>
      <form onSubmit={handleConnect} className="w-full flex flex-col gap-3 mt-4">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Owner (e.g. acme)"
            required
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-center"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
          <input
            type="text"
            placeholder="Repo name"
            required
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-center"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <input
          type="text"
          placeholder="Default Branch"
          className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-center"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {busy ? 'Connecting...' : 'Connect Repository'}
        </button>
      </form>
    </div>
  )
}
