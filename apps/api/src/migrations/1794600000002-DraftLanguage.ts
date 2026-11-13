import { MigrationInterface, QueryRunner } from 'typeorm'

export class DraftLanguage1794600000002 implements MigrationInterface {
  name = 'DraftLanguage1794600000002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `drafts` ADD `language` varchar(2) NOT NULL DEFAULT 'en', ADD `englishText` text NULL, ADD `englishSentences` json NULL")
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `drafts` DROP COLUMN `englishSentences`, DROP COLUMN `englishText`, DROP COLUMN `language`')
  }
}
