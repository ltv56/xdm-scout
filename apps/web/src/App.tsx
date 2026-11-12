import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import Prospects from './Prospects'

interface Health {
  status: string
  db: string
}

export default function App() {
  const [campaignId, setCampaignId] = useState(1)
  const { data, error } = useQuery<Health>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      return res.json()
    },
  })

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">xdm-scout</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {error ? error.message : data ? `API ${data.status}, database ${data.db}` : 'Checking API...'}
      </p>
      <label className="mt-6 flex items-center gap-2 text-sm">
        Campaign
        <input
          type="number"
          min={1}
          value={campaignId}
          onChange={(e) => setCampaignId(Math.max(1, Number(e.target.value) || 1))}
          className="w-20 rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <Prospects campaignId={campaignId} />
    </main>
  )
}
