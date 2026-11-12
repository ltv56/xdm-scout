import { MigrationInterface, QueryRunner } from "typeorm";

export class SearchQueries1794441793672 implements MigrationInterface {
    name = 'SearchQueries1794441793672'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` ADD \`queries\` json NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` DROP COLUMN \`queries\``);
    }

}
