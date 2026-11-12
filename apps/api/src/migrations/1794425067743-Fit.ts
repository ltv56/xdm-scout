import { MigrationInterface, QueryRunner } from "typeorm";

export class Fit1794425067743 implements MigrationInterface {
    name = 'Fit1794425067743'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`evidence\` (\`id\` varchar(48) NOT NULL, \`xUserId\` varchar(32) NOT NULL, \`kind\` varchar(8) NOT NULL, \`url\` varchar(255) NOT NULL, \`excerpt\` text NOT NULL, \`postedAt\` datetime(3) NULL, \`fetchedAt\` datetime(3) NOT NULL, INDEX \`IDX_a385d31e345a6bc974a0c4fd15\` (\`xUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`claims\` (\`id\` int NOT NULL AUTO_INCREMENT, \`prospectId\` int NOT NULL, \`side\` varchar(8) NOT NULL, \`text\` text NOT NULL, \`evidenceIds\` json NOT NULL, \`status\` varchar(8) NOT NULL, INDEX \`IDX_dcb51acba2b46d583b94145ff4\` (\`prospectId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`fit\` varchar(16) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`role\` varchar(16) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`areas\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`openingType\` varchar(16) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`openingSummary\` varchar(512) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`openingEvidenceId\` varchar(48) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`openingDate\` datetime(3) NULL`);
        await queryRunner.query(`ALTER TABLE \`prospects\` ADD \`scoredAt\` datetime(3) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`scoredAt\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`openingDate\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`openingEvidenceId\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`openingSummary\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`openingType\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`areas\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`role\``);
        await queryRunner.query(`ALTER TABLE \`prospects\` DROP COLUMN \`fit\``);
        await queryRunner.query(`DROP INDEX \`IDX_dcb51acba2b46d583b94145ff4\` ON \`claims\``);
        await queryRunner.query(`DROP TABLE \`claims\``);
        await queryRunner.query(`DROP INDEX \`IDX_a385d31e345a6bc974a0c4fd15\` ON \`evidence\``);
        await queryRunner.query(`DROP TABLE \`evidence\``);
    }

}
