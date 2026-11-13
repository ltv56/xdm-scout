import { expect, type APIRequestContext } from '@playwright/test'

export const CAMPAIGN = {
  name: 'robotics demo',
  keywords: ['robotics', 'llm', 'embodied'],
  handles: ['mina_builds', '@tomas_agents', 'lena_embodied', 'robotco', 'private_dev', 'pasta_daily', 'nobody_here'],
}

// Finds or creates the demo campaign, runs discovery and scoring on the fake X, and waits for the people to show up.
export async function ensureCampaign(request: APIRequestContext): Promise<number> {
  const list = await (await request.get('/api/campaigns')).json()
  const found = list.find((c: { name: string }) => c.name === CAMPAIGN.name)
  const id: number = found ? found.id : (await (await request.post('/api/campaigns', { data: CAMPAIGN })).json()).id
  await expect(async () => {
    const people = await (await request.get(`/api/campaigns/${id}/prospects`)).json()
    if (people.length === 0) {
      await request.post(`/api/campaigns/${id}/discover`)
      throw new Error('discovery not finished')
    }
    if (people.some((p: { fit: string | null }) => p.fit === null)) {
      await request.post(`/api/campaigns/${id}/score`)
      throw new Error('scoring not finished')
    }
  }).toPass({ timeout: 60_000, intervals: [2_000] })
  return id
}
