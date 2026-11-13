import { MigrationInterface, QueryRunner } from 'typeorm'

export class PostLang1794600000001 implements MigrationInterface {
  name = 'PostLang1794600000001'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `x_posts` ADD `lang` varchar(8) NULL')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `x_posts` DROP COLUMN `lang`')
  }
}
