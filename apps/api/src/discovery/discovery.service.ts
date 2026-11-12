import { Inject, Injectable } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { Contact, DoNotContact, SendAttempt, XUser } from '../sending/entities'
import { X_CLIENT, XClient, XProfile } from '../x/x-client'
import { ApiUsage, Campaign, Prospect, XPost } from './entities'
import { MAX_POSTS_PER_USER, PRICES } from './pricing'

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
    const handles = uniqueHandles(campaign)
    const known = await this.knownByHandle()
    const profiles = handles.filter((h) => isStale(known.get(h), now)).length
    let needPosts = 0
    for (const h of handles) {
      const user = known.get(h)
      if (!user || !(await this.hasPosts(user.xUserId))) needPosts += 1
    }
    const maxPosts = needPosts * MAX_POSTS_PER_USER
    return { profiles, maxPosts, estimatedMicros: profiles * PRICES.profile + maxPosts * PRICES.post }
  }

  async run(campaignId: number, now = new Date()) {
    const campaign = await this.ds.getRepository(Campaign).findOneByOrFail({ id: campaignId })
    const handles = uniqueHandles(campaign)
    const startSpent = await this.spent(campaignId)
    let stoppedByBudget = false

    const known = await this.knownByHandle()
    const stale = handles.filter((h) => isStale(known.get(h), now))
    const affordable = Math.max(0, Math.floor((campaign.budgetMicros - startSpent) / PRICES.profile))
    const toFetch = stale.slice(0, affordable)
    if (toFetch.length) {
      const profiles = await this.x.lookupUsers(toFetch)
      for (const p of profiles) known.set(p.handle.toLowerCase(), await this.ds.getRepository(XUser).save(toUser(p, now)))
      await this.recordUsage(campaignId, 'profile', profiles.length, PRICES.profile)
    }

    const skipped: { handle: string; reason: SkipReason }[] = []
    const added: XUser[] = []
    for (const handle of handles) {
      const user = known.get(handle)
      if (!user && stale.indexOf(handle) >= affordable) {
        skipped.push({ handle, reason: 'budget' })
        stoppedByBudget = true
        continue
      }
      const reason = user ? await this.skipReason(user, campaign.keywords) : 'not-found'
      if (reason) skipped.push({ handle, reason })
      else if (user) added.push(user)
    }
    for (const user of added) {
      await this.ds
        .getRepository(Prospect)
        .createQueryBuilder()
        .insert()
        .values({ campaignId, xUserId: user.xUserId, relationship: 'cold' })
        .orIgnore()
        .updateEntity(false)
        .execute()
    }

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
    return this.ds.getRepository(XPost).existsBy({ xUserId })
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

  private recordUsage(campaignId: number, kind: 'profile' | 'post', count: number, unit: number) {
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

const uniqueHandles = (campaign: Campaign) => [...new Set(campaign.handles.map((h) => h.replace(/^@/, '').toLowerCase()))]

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
