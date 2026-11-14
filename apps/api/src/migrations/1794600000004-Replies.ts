import { MigrationInterface, QueryRunner } from 'typeorm'

export class Replies1794600000004 implements MigrationInterface {
  name = 'Replies1794600000004'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE `replies` (`id` int NOT NULL AUTO_INCREMENT, `contactId` int NOT NULL, `attemptId` int NOT NULL, `xEventId` varchar(32) NULL, `text` text NULL, `source` varchar(8) NOT NULL, `at` datetime(3) NOT NULL, `handledAt` datetime(3) NULL, INDEX `IDX_3667c0cf1d8bbf0ff5733fc572` (`contactId`), UNIQUE INDEX `IDX_dd9e6e574e30f007c671d442f5` (`xEventId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
    )
    await queryRunner.query('ALTER TABLE `contacts` ADD `repliesReadAt` datetime(3) NULL')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `contacts` DROP COLUMN `repliesReadAt`')
    await queryRunner.query('DROP TABLE `replies`')
  }
}
