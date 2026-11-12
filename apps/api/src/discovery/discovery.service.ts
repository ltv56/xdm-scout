import { Inject, Injectable } from '@nestjs/common'
import { DataSource, In, Not } from 'typeorm'
import { Contact, DoNotContact, RelationshipContext, SendAttempt, XUser } from '../sending/entities'
import { X_CLIENT, XClient, XProfile } from '../x/x-client'
import { ApiUsage, Campaign, Prospect, XPost } from './entities'
import { MAX_FOLLOWING_PER_SEED, MAX_POSTS_PER_USER, PRICES } from './pricing'

const FRESH_MS = 7 * 86_400_000

export type SkipReason =
  | 'not-found'
  | 'protected'
  | 'organization'
  | 'do-not-contact'
  | 'already-contacted'
  | 'off-topic'
  | 'budget'

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly ds: DataSource,
    @Inject(X_CLIENT) private readonly x: XClient,
  ) {}

  async estimate(campaignId: number, now = new Date()) {
    const campaign = await this.ds.getRepository(Campaign).findOneByOrFail({ id: campaignId })
    const handles = uniqueHandles(campaign.handles)
    const seeds = uniqueHandles(campaign.seeds ?? [])
    const known = await this.knownByHandle()
    const profiles = unique([...handles, ...seeds]).filter((h) => isStale(known.get(h), now)).length
    let needPosts = 0
    for (const h of handles) {
      const user = known.get(h)
      if (!user || !(await this.hasPosts(user.xUserId))) needPosts += 1
    }
    const maxPosts = needPosts * MAX_POSTS_PER_USER
    const maxFollowing = seeds.length * MAX_FOLLOWING_PER_SEED
    return {
      profiles,
      maxPosts,
      maxFollowing,
      estimatedMicros: profiles * PRICES.profile + maxPosts * PRICES.post + maxFollowing * PRICES.following,
    }
  }

  async run(campaignId: number, now = new Date()) {
    const campaign = await this.ds.getRepository(Campaign).findOneByOrFail({ id: campaignId })
    const handles = uniqueHandles(campaign.handles)
    const seeds = uniqueHandles(campaign.seeds ?? [])
    const startSpent = await this.spent(campaignId)
    let stoppedByBudget = false

    const known = await this.knownByHandle()
    const stale = unique([...handles, ...seeds]).filter((h) => isStale(known.get(h), now))
    const affordable = Math.max(0, Math.floor((campaign.budgetMicros - startSpent) / PRICES.profile))
    const unaffordable = new Set(stale.slice(affordable))
    const toFetch = stale.slice(0, affordable)
    if (toFetch.length) {
      const profiles = await this.x.lookupUsers(toFetch)
      for (const p of profiles) known.set(p.handle.toLowerCase(), await this.ds.getRepository(XUser).save(toUser(p, now)))
      await this.recordUsage(campaignId, 'profile', profiles.length, PRICES.profile)
    }

    const skipped: { handle: string; reason: SkipReason }[] = []
    const candidates = new Map<string, Candidate>()
    for (const handle of [...handles, ...seeds]) {
      if (known.has(handle)) continue
      skipped.push({ handle, reason: unaffordable.has(handle) ? 'budget' : 'not-found' })
      if (unaffordable.has(handle)) stoppedByBudget = true
    }
    for (const handle of handles) {
      const user = known.get(handle)
      if (user) candidates.set(user.xUserId, { handle, user, relationship: 'cold', seedCount: 0 })
    }
    const seedIds = new Set(seeds.flatMap((s) => known.get(s)?.xUserId ?? []))
    for (const seedId of seedIds) {
      const max = Math.min(MAX_FOLLOWING_PER_SEED, Math.floor((campaign.budgetMicros - (await this.spent(campaignId))) / PRICES.following))
      if (max <= 0) {
        stoppedByBudget = true
        continue
      }
      const following = await this.x.getFollowing(seedId, max)
      await this.recordUsage(campaignId, 'following', following.length, PRICES.following)
      for (const p of following) {
        if (seedIds.has(p.id)) continue
        const user = await this.ds.getRepository(XUser).save(toUser(p, now))
        const seen = candidates.get(p.id)
        if (seen) Object.assign(seen, { relationship: 'adjacent', seedCount: seen.seedCount + 1 })
        else candidates.set(p.id, { handle: p.handle, user, relationship: 'adjacent', seedCount: 1 })
      }
    }

    const kept: Candidate[] = []
    for (const c of candidates.values()) {
      const reason = await this.skipReason(c.user, campaign.keywords)
      if (reason) skipped.push({ handle: c.handle, reason })
      else kept.push(c)
    }
    kept.sort((a, b) => b.seedCount - a.seedCount)
    for (const c of kept) {
      await this.ds
        .getRepository(Prospect)
        .createQueryBuilder()
        .insert()
        .values({ campaignId, xUserId: c.user.xUserId, relationship: c.relationship, seedCount: c.seedCount })
        .orIgnore()
        .updateEntity(false)
        .execute()
    }
    const added = kept.map((c) => c.user)

    let postsPending = 0
    for (const user of added) {
      if (await this.hasPosts(user.xUserId)) continue
      const remaining = campaign.budgetMicros - (await this.spent(campaignId))
      if (remaining < MAX_POSTS_PER_USER * PRICES.post) {
        postsPending += 1
        stoppedByBudget = true
        continue
      }
      const posts = await this.x.getRecentPosts(user.xUserId, MAX_POSTS_PER_USER)
      if (posts.length) {
        await this.ds.getRepository(XPost).save(
          posts.map((p) => ({ postId: p.id, xUserId: p.userId, text: p.text, postedAt: p.createdAt, fetchedAt: now })),
        )
        await this.recordUsage(campaignId, 'post', posts.length, PRICES.post)
      }
    }

    return { added: added.length, skipped, spentMicros: (await this.spent(campaignId)) - startSpent, stoppedByBudget, postsPending }
  }

  private async knownByHandle() {
    const users = await this.ds.getRepository(XUser).find()
    return new Map(users.map((u) => [u.handle.toLowerCase(), u]))
  }

  private hasPosts(xUserId: string) {
    return this.ds.getRepository(XPost).existsBy({ xUserId, text: Not('') })
  }

  private async spent(campaignId: number) {
    const row = await this.ds
      .getRepository(ApiUsage)
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.costMicros), 0)', 's')
      .where('u.campaignId = :campaignId', { campaignId })
      .getRawOne<{ s: string }>()
    return Number(row?.s ?? 0)
  }

  private recordUsage(campaignId: number, kind: ApiUsage['kind'], count: number, unit: number) {
    return this.ds.getRepository(ApiUsage).save({ campaignId, kind, count, costMicros: count * unit })
  }

  private async skipReason(user: XUser, keywords: string[]): Promise<SkipReason | null> {
    if (user.isProtected) return 'protected'
    if (user.orgType) return 'organization'
    if (await this.ds.getRepository(DoNotContact).existsBy({ xUserId: user.xUserId })) return 'do-not-contact'
    if (await this.wasContacted(user.xUserId)) return 'already-contacted'
    const bio = (user.bio ?? '').toLowerCase()
    if (!keywords.some((k) => bio.includes(k.toLowerCase()))) return 'off-topic'
    return null
  }

  private async wasContacted(xUserId: string) {
    const contacts = await this.ds.getRepository(Contact).findBy({ xUserId })
    if (!contacts.length) return false
    return this.ds.getRepository(SendAttempt).existsBy({
      contactId: In(contacts.map((c) => c.id)),
      status: In(['sent', 'unknown', 'manual_pending', 'manual_unverified']),
    })
  }
}

type Candidate = { handle: string; user: XUser; relationship: RelationshipContext; seedCount: number }

const unique = <T>(items: T[]) => [...new Set(items)]

const uniqueHandles = (handles: string[]) => unique(handles.map((h) => h.replace(/^@/, '').toLowerCase()))

const isStale = (user: XUser | undefined, now: Date) => !user?.fetchedAt || now.getTime() - user.fetchedAt.getTime() > FRESH_MS

function toUser(p: XProfile, now: Date): XUser {
  return Object.assign(new XUser(), {
    xUserId: p.id,
    handle: p.handle,
    name: p.name,
    bio: p.bio,
    followers: p.followers,
    isProtected: p.isProtected,
    orgType: p.orgType,
    receivesYourDm: p.receivesYourDm,
    fetchedAt: now,
  })
}
