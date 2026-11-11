import { useQuery } from '@tanstack/react-query'

interface Health {
  status: string
  db: string
}

export default function App() {
  const { data, error } = useQuery<Health>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      return res.json()
    },
  })

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">xdm-scout</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {error ? error.message : data ? `API ${data.status}, database ${data.db}` : 'Checking API...'}
      </p>
    </main>
  )
}
