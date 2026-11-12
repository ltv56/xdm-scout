import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

const KEEP_DAYS = 7

const LIVE_DRAFT_USERS = `SELECT c.xUserId FROM contacts c JOIN drafts d ON d.contactId = c.id WHERE d.status IN ('pending', 'approved')`

// X data we no longer need: post text after scoring, uncited evidence, and profile text and excerpts after 7 days.
@Injectable()
export class RetentionService {
  constructor(private readonly ds: DataSource) {}

  async sweep(now: Date) {
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000)
    await this.ds.query(
      `UPDATE x_posts p SET p.text = '' WHERE p.text <> ''
        AND EXISTS (SELECT 1 FROM prospects s WHERE s.xUserId = p.xUserId)
        AND NOT EXISTS (SELECT 1 FROM prospects s WHERE s.xUserId = p.xUserId AND s.scoredAt IS NULL)`,
    )
    await this.ds.query(
      `DELETE e FROM evidence e WHERE e.kind = 'post'
        AND NOT EXISTS (SELECT 1 FROM prospects s WHERE s.openingEvidenceId = e.id)
        AND NOT EXISTS (SELECT 1 FROM claims c WHERE JSON_CONTAINS(c.evidenceIds, JSON_QUOTE(e.id)))`,
    )
    await this.ds.query(
      `UPDATE evidence SET excerpt = '' WHERE excerpt <> '' AND fetchedAt < ? AND xUserId NOT IN (${LIVE_DRAFT_USERS})`,
      [cutoff],
    )
    await this.ds.query(
      `UPDATE x_users SET name = NULL, bio = NULL, followers = NULL
        WHERE fetchedAt < ? AND (name IS NOT NULL OR bio IS NOT NULL OR followers IS NOT NULL)
        AND xUserId NOT IN (${LIVE_DRAFT_USERS})`,
      [cutoff],
    )
  }
}
