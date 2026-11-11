import { Inject, Injectable } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { Contact, DoNotContact, SendAttempt, XUser } from '../sending/entities'
import { X_CLIENT, XClient, XProfile } from '../x/x-client'
import { Campaign, Prospect } from './entities'

const FRESH_MS = 7 * 86_400_000

export type SkipReason = 'not-found' | 'protected' | 'organization' | 'do-not-contact' | 'already-contacted' | 'off-topic'

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly ds: DataSource,
    @Inject(X_CLIENT) private readonly x: XClient,
  ) {}

  async run(campaignId: number, now = new Date()) {
    const campaign = await this.ds.getRepository(Campaign).findOneByOrFail({ id: campaignId })
    const handles = [...new Set(campaign.handles.map((h) => h.replace(/^@/, '').toLowerCase()))]
    const users = await this.loadProfiles(handles, now)

    const skipped: { handle: string; reason: SkipReason }[] = []
    const added: XUser[] = []
    for (const handle of handles) {
      const user = users.get(handle)
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
    return { added: added.length, skipped }
  }

  private async loadProfiles(handles: string[], now: Date) {
    const repo = this.ds.getRepository(XUser)
    const known = await repo.find()
    const byHandle = new Map(known.map((u) => [u.handle.toLowerCase(), u]))
    const stale = handles.filter((h) => {
      const u = byHandle.get(h)
      return !u?.fetchedAt || now.getTime() - u.fetchedAt.getTime() > FRESH_MS
    })
    if (stale.length) {
      for (const p of await this.x.lookupUsers(stale)) {
        const saved = await repo.save(toUser(p, now))
        byHandle.set(p.handle.toLowerCase(), saved)
      }
    }
    return byHandle
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
