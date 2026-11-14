import { MigrationInterface, QueryRunner } from 'typeorm'

export class ReplyClass1794600000005 implements MigrationInterface {
  name = 'ReplyClass1794600000005'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `replies` ADD `replyClass` varchar(16) NULL, ADD `classBy` varchar(8) NULL')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `replies` DROP COLUMN `classBy`, DROP COLUMN `replyClass`')
  }
}
