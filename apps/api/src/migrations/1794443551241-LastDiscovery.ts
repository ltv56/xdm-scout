import { MigrationInterface, QueryRunner } from "typeorm";

export class LastDiscovery1794443551241 implements MigrationInterface {
    name = 'LastDiscovery1794443551241'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` ADD \`lastDiscovery\` json NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` DROP COLUMN \`lastDiscovery\``);
    }

}
