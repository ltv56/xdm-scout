import { MigrationInterface, QueryRunner } from 'typeorm'

export class SendVerifiedBy1794600000003 implements MigrationInterface {
  name = 'SendVerifiedBy1794600000003'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `send_attempts` ADD `verifiedBy` varchar(8) NULL')
    // Sends recorded before this column had an X event id only when the API saw them.
    await queryRunner.query("UPDATE `send_attempts` SET `verifiedBy` = 'api' WHERE `status` = 'sent' AND `xEventId` IS NOT NULL")
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `send_attempts` DROP COLUMN `verifiedBy`')
  }
}
