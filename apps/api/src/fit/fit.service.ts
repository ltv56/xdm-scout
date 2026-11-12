import { Inject, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign, CriterionResult, Prospect, XPost } from '../discovery/entities'
import { LLM_CLIENT, LlmClient } from '../llm/llm-client'
import { XUser } from '../sending/entities'
import { Claim, ClaimSide, ClaimStatus, Evidence } from './entities'
import { FitResult, fitSchema, verifySchema } from './fit.schema'
import { FIT_SYSTEM, VERIFY_SYSTEM } from './prompts'

const DAY = 86_400_000

export function openingFreshness(date: Date, now: Date): 'fresh' | 'stale' | 'expired' {
  const days = (now.getTime() - date.getTime()) / DAY
  if (days > 90) return 'expired'
  return days > 30 ? 'stale' : 'fresh'
}

@Injectable()
export class FitService {
  constructor(
    private readonly ds: DataSource,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  async score(prospectId: number, now = new Date()) {
    const prospect = await this.ds.getRepository(Prospect).findOneByOrFail({ id: prospectId })
    const user = await this.ds.getRepository(XUser).findOneByOrFail({ xUserId: prospect.xUserId })
    const posts = await this.ds.getRepository(XPost).find({ where: { xUserId: user.xUserId }, order: { postedAt: 'DESC' } })

    const evidence = buildEvidence(user, posts, now)
    await this.ds.getRepository(Evidence).save(evidence)
    const byId = new Map(evidence.map((e) => [e.id, e]))

    const campaign = await this.ds.getRepository(Campaign).findOneBy({ id: prospect.campaignId })
    const criteriaText = campaign?.criteria ?? []

    const fit = await this.askFit(evidence, criteriaText)
    const claims = await this.checkClaims(prospectId, fit, byId)
    const criteria = await this.checkCriteria(criteriaText, fit, byId)
    const opening = fit.opening.type !== 'none' && fit.opening.evidence_id ? byId.get(fit.opening.evidence_id) : undefined

    await this.ds.transaction(async (em) => {
      await em.delete(Claim, { prospectId })
      await em.save(Claim, claims)
      await em.update(Prospect, prospectId, {
        fit: fit.fit,
        role: fit.role,
        areas: fit.areas,
        openingType: opening ? fit.opening.type : 'none',
        openingSummary: opening ? fit.opening.summary : null,
        openingEvidenceId: opening ? opening.id : null,
        openingDate: opening?.postedAt ?? null,
        criteria,
        scoredAt: now,
      })
    })
  }

  // Met or not met needs evidence that exists and passes the same second check as claims.
  private async checkCriteria(texts: string[], fit: FitResult, byId: Map<string, Evidence>): Promise<CriterionResult[]> {
    const out: CriterionResult[] = []
    for (const [i, text] of texts.entries()) {
      const answer = fit.criteria[i]
      const claim = answer?.status === 'not_met' ? `It is not the case that: ${text}` : text
      const checked = answer && answer.status !== 'unknown' && (await this.verify(claim, answer.evidence_ids, byId)) === 'verified'
      out.push(checked ? { text, status: answer.status, evidenceIds: answer.evidence_ids } : { text, status: 'unknown', evidenceIds: [] })
    }
    return out
  }

  private async askFit(evidence: Evidence[], criteria: string[]): Promise<FitResult> {
    const items = evidence.map((e) => ({ id: e.id, text: e.excerpt, date: e.postedAt?.toISOString() ?? null }))
    const user = JSON.stringify(criteria.length ? { evidence: items, criteria } : { evidence: items })
    let lastError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = fitSchema.safeParse(await this.llm.completeJson({ task: 'fit', system: FIT_SYSTEM, user }))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    }
    throw new Error(`invalid model output after retry: ${lastError}`)
  }

  private async checkClaims(prospectId: number, fit: FitResult, byId: Map<string, Evidence>): Promise<Omit<Claim, 'id'>[]> {
    const rows: Omit<Claim, 'id'>[] = []
    const sides: [ClaimSide, FitResult['reasons_for']][] = [
      ['for', fit.reasons_for],
      ['against', fit.reasons_against],
    ]
    for (const [side, list] of sides) {
      for (const c of list) {
        rows.push({ prospectId, side, text: c.claim, evidenceIds: c.evidence_ids, status: await this.verify(c.claim, c.evidence_ids, byId) })
      }
    }
    for (const text of fit.unknowns) rows.push({ prospectId, side: 'unknown', text, evidenceIds: [], status: 'inferred' })
    return rows
  }

  private async verify(claim: string, ids: string[], byId: Map<string, Evidence>): Promise<ClaimStatus> {
    const cited = ids.map((id) => byId.get(id))
    if (!cited.length || cited.some((e) => !e)) return 'inferred'
    const user = JSON.stringify({ claim, excerpts: cited.map((e) => ({ id: e?.id, text: e?.excerpt })) })
    const answer = verifySchema.safeParse(await this.llm.completeJson({ task: 'verify', system: VERIFY_SYSTEM, user }))
    return answer.success && answer.data.supported ? 'verified' : 'inferred'
  }
}

function buildEvidence(user: XUser, posts: XPost[], now: Date): Evidence[] {
  const bio = Object.assign(new Evidence(), {
    id: `bio:${user.xUserId}`,
    xUserId: user.xUserId,
    kind: 'bio' as const,
    url: `https://x.com/${user.handle}`,
    excerpt: user.bio ?? '',
    postedAt: null,
    fetchedAt: user.fetchedAt ?? now,
  })
  const fromPosts = posts.map((p) =>
    Object.assign(new Evidence(), {
      id: `post:${p.postId}`,
      xUserId: user.xUserId,
      kind: 'post' as const,
      url: `https://x.com/${user.handle}/status/${p.postId}`,
      excerpt: p.text,
      postedAt: p.postedAt,
      fetchedAt: p.fetchedAt,
    }),
  )
  return [bio, ...fromPosts]
}
