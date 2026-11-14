import { expect, type APIRequestContext } from '@playwright/test'

export const CAMPAIGN = {
  name: 'robotics demo',
  keywords: ['robotics', 'llm', 'embodied'],
  handles: ['mina_builds', '@tomas_agents', 'lena_embodied', 'robotco', 'private_dev', 'pasta_daily', 'nobody_here'],
}

const PROFILE = {
  intro: 'GenAI Fund backs early AI founders in Southeast Asia.',
  programs: [{ id: 1, name: 'Agentic AI Build Week', description: 'A build week for AI agents across Southeast Asia.', link: 'https://genaifund.ai/', deadline: null }],
  signer: 'Vinh',
  sampleMessages: [],
}

// Finds or creates the demo campaign, runs discovery and scoring on the fake X, and waits for the people to show up.
export async function ensureCampaign(request: APIRequestContext): Promise<number> {
  const list = await (await request.get('/api/campaigns')).json()
  const found = list.find((c: { name: string }) => c.name === CAMPAIGN.name)
  const id: number = found ? found.id : (await (await request.post('/api/campaigns', { data: CAMPAIGN })).json()).id
  await waitForScoredPeople(request, id)
  return id
}

// A new campaign with drafts written by the worker, so each spec file gets its own pending drafts.
// Discovery skips people an earlier run approved; global-setup empties the database so none are left.
export async function draftCampaign(request: APIRequestContext): Promise<string> {
  if ((await (await request.get('/api/sender-profile')).text()) === '') await request.put('/api/sender-profile', { data: PROFILE })
  expect((await request.post('/api/auth/x/fake')).ok()).toBe(true)
  const name = `review ${Date.now()}`
  const { id } = await (await request.post('/api/campaigns', { data: { ...CAMPAIGN, name } })).json()
  await waitForScoredPeople(request, id)
  const people = await (await request.get(`/api/campaigns/${id}/prospects`)).json()
  expect(people.length, 'People were approved by an earlier run: does the API use the database in E2E_DATABASE_URL?').toBeGreaterThanOrEqual(3)
  await request.post(`/api/campaigns/${id}/drafts`, { data: { limit: 10 } })
  await expect(async () => {
    const queue = await (await request.get(`/api/review-queue?campaignId=${id}`)).json()
    expect(queue.items.filter((i: { status: string }) => i.status === 'pending').length).toBeGreaterThanOrEqual(3)
  }).toPass({ timeout: 60_000, intervals: [2_000] })
  return name
}

async function waitForScoredPeople(request: APIRequestContext, id: number) {
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
}
