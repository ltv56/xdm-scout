import { MigrationInterface, QueryRunner } from "typeorm";

export class Discovery1794424467349 implements MigrationInterface {
    name = 'Discovery1794424467349'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`campaigns\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(128) NOT NULL, \`keywords\` json NOT NULL, \`handles\` json NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`prospects\` (\`id\` int NOT NULL AUTO_INCREMENT, \`campaignId\` int NOT NULL, \`xUserId\` varchar(32) NOT NULL, \`relationship\` varchar(16) NOT NULL DEFAULT 'cold', \`status\` varchar(16) NOT NULL DEFAULT 'new', UNIQUE INDEX \`IDX_478f68fc59570421c16ec825b4\` (\`campaignId\`, \`xUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`name\` varchar(128) NULL`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`bio\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`followers\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`isProtected\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`orgType\` varchar(16) NULL`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`receivesYourDm\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`x_users\` ADD \`fetchedAt\` datetime(3) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`fetchedAt\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`receivesYourDm\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`orgType\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`isProtected\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`followers\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`bio\``);
        await queryRunner.query(`ALTER TABLE \`x_users\` DROP COLUMN \`name\``);
        await queryRunner.query(`DROP INDEX \`IDX_478f68fc59570421c16ec825b4\` ON \`prospects\``);
        await queryRunner.query(`DROP TABLE \`prospects\``);
        await queryRunner.query(`DROP TABLE \`campaigns\``);
    }

}
