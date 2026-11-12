import { Injectable } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { Claim, Evidence } from '../fit/entities'
import { openingFreshness } from '../fit/fit.service'
import { XUser } from '../sending/entities'
import { Prospect } from './entities'

const FIT_RANK = { strong: 0, possible: 1, weak: 2, not_a_fit: 3 }

@Injectable()
export class ProspectsService {
  constructor(private readonly ds: DataSource) {}

  async list(campaignId: number, now = new Date()) {
    const prospects = (await this.ds.getRepository(Prospect).find({ where: { campaignId } })).sort(
      (a, b) =>
        (a.fit ? FIT_RANK[a.fit] : 9) - (b.fit ? FIT_RANK[b.fit] : 9) ||
        b.seedCount - a.seedCount ||
        (b.openingDate?.getTime() ?? 0) - (a.openingDate?.getTime() ?? 0) ||
        a.id - b.id,
    )
    const users = new Map((await this.ds.getRepository(XUser).findBy({ xUserId: In(prospects.map((p) => p.xUserId)) })).map((u) => [u.xUserId, u]))
    const claims = await this.ds.getRepository(Claim).findBy({ prospectId: In(prospects.map((p) => p.id)) })
    const evidence = new Map((await this.ds.getRepository(Evidence).find()).map((e) => [e.id, e]))

    const rows = prospects.map((p) => {
      const user = users.get(p.xUserId)
      const opening = p.openingType && p.openingType !== 'none' && p.openingDate
        ? {
            type: p.openingType,
            summary: p.openingSummary,
            date: p.openingDate,
            freshness: openingFreshness(p.openingDate, now),
            url: p.openingEvidenceId ? (evidence.get(p.openingEvidenceId)?.url ?? null) : null,
          }
        : null
      return {
        id: p.id,
        handle: user?.handle ?? '',
        name: user?.name ?? '',
        bio: user?.bio ?? '',
        followers: user?.followers ?? 0,
        relationship: p.relationship,
        seedCount: p.seedCount,
        status: p.status,
        fit: p.fit,
        role: p.role,
        areas: p.areas ?? [],
        opening,
        identityWarning: /parody|\bfan\b/i.test(user?.bio ?? ''),
        claims: claims
          .filter((c) => c.prospectId === p.id)
          .map((c) => ({
            side: c.side,
            text: c.text,
            status: c.status,
            evidence: c.evidenceIds.flatMap((id) => {
              const e = evidence.get(id)
              return e ? [{ id, url: e.url }] : []
            }),
          })),
      }
    })

    return rows
  }
}
