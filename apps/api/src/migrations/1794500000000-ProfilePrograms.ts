import { MigrationInterface, QueryRunner } from 'typeorm'
import { upgradeProfile, upgradeSentences } from '../review/legacy-profile'

export class ProfilePrograms1794500000000 implements MigrationInterface {
  name = 'ProfilePrograms1794500000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [row] = await queryRunner.query("SELECT `value` FROM `settings` WHERE `key` = 'sender_profile'")
    if (row) {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      await queryRunner.query("UPDATE `settings` SET `value` = ? WHERE `key` = 'sender_profile'", [JSON.stringify(upgradeProfile(value))])
    }
    const drafts: { id: number; sentences: unknown }[] = await queryRunner.query('SELECT `id`, `sentences` FROM `drafts` WHERE `sentences` IS NOT NULL')
    for (const d of drafts) {
      const sentences = typeof d.sentences === 'string' ? JSON.parse(d.sentences) : d.sentences
      await queryRunner.query('UPDATE `drafts` SET `sentences` = ? WHERE `id` = ?', [JSON.stringify(upgradeSentences(sentences as never)), d.id])
    }
  }

  // One way: programs carry more than offers did, so there is nothing to restore.
  public async down(): Promise<void> {}
}
