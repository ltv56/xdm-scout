import { MigrationInterface, QueryRunner } from "typeorm";

export class Seeds1794441548053 implements MigrationInterface {
    name = 'Seeds1794441548053'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` ADD \`seeds\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`seedCount\` int NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`seedCount\``);
        await queryRunner.query(`ALTER TABLE \`campaigns\` DROP COLUMN \`seeds\``);
    }

}
