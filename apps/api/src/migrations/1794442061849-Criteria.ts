import { MigrationInterface, QueryRunner } from "typeorm";

export class Criteria1794442061849 implements MigrationInterface {
    name = 'Criteria1794442061849'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` ADD \`criteria\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`criteria\` json NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`criteria\``);
        await queryRunner.query(`ALTER TABLE \`campaigns\` DROP COLUMN \`criteria\``);
    }

}
