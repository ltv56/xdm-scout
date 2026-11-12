import { MigrationInterface, QueryRunner } from "typeorm";

export class DraftSources1794480307569 implements MigrationInterface {
    name = 'DraftSources1794480307569'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`prospectId\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`kind\` varchar(16) NOT NULL DEFAULT 'first_message'`);
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`sendPath\` varchar(16) NOT NULL DEFAULT 'HUMAN_HANDOFF'`);
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`sentences\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`editedByReviewer\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`editedByReviewer\``);
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`sentences\``);
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`sendPath\``);
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`kind\``);
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`prospectId\``);
    }

}
