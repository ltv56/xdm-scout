import { MigrationInterface, QueryRunner } from 'typeorm'

export class CampaignProgram1794600000000 implements MigrationInterface {
  name = 'CampaignProgram1794600000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `campaigns` ADD `programId` int NULL, ADD `callPostUrl` varchar(300) NULL, ADD `callKeyword` varchar(40) NULL, ADD `callPostedAt` datetime(3) NULL')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `campaigns` DROP COLUMN `callPostedAt`, DROP COLUMN `callKeyword`, DROP COLUMN `callPostUrl`, DROP COLUMN `programId`')
  }
}
