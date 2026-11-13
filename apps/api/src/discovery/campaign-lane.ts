import { BadRequestException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { senderProfile } from '../review/contract'
import { Setting } from '../setting.entity'
import { postedAtFromId } from '../x/post-id'

export interface LaneInput {
  programId?: number | null
  callPostUrl?: string | null
  callKeyword?: string | null
}

const STATUS_URL = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{10,20})(?:[/?#].*)?$/

// The program must be in the sender profile; the call post and keyword come together or not at all.
export async function resolveLane(ds: DataSource, input: LaneInput) {
  const programId = input.programId ?? null
  if (programId !== null) {
    const row = await ds.getRepository(Setting).findOneBy({ key: 'sender_profile' })
    const profile = senderProfile.safeParse(row?.value)
    if (!profile.success || !profile.data.programs.some((p) => p.id === programId)) throw new BadRequestException('Pick a program from the sender profile')
  }
  const callPostUrl = input.callPostUrl?.trim() || null
  const callKeyword = input.callKeyword?.trim() || null
  if ((callPostUrl === null) !== (callKeyword === null)) throw new BadRequestException('Give both the call post and the keyword, or neither')
  if (callKeyword && callKeyword.length > 40) throw new BadRequestException('The keyword is at most 40 characters')
  let callPostedAt: Date | null = null
  if (callPostUrl) {
    const id = STATUS_URL.exec(callPostUrl)?.[1]
    if (!id) throw new BadRequestException('Paste the link of a post on X, like https://x.com/yourfund/status/123')
    callPostedAt = postedAtFromId(id)
    if (!callPostedAt || callPostedAt.getTime() > Date.now() + 86_400_000) throw new BadRequestException('That post id does not look right')
  }
  return { programId, callPostUrl, callKeyword, callPostedAt }
}
