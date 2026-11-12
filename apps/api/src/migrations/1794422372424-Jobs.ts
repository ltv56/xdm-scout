import { MigrationInterface, QueryRunner } from "typeorm";

export class Jobs1794422372424 implements MigrationInterface {
    name = 'Jobs1794422372424'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`jobs\` (\`id\` int NOT NULL AUTO_INCREMENT, \`type\` varchar(32) NOT NULL, \`payload\` json NOT NULL, \`runAt\` datetime(3) NOT NULL, \`status\` varchar(16) NOT NULL DEFAULT 'pending', \`error\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_f0517eec3f63f617ee5138edeb\` (\`status\`, \`runAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`send_attempts\` ADD \`runAt\` datetime(3) NULL`);
        await queryRunner.query(`ALTER TABLE \`send_attempts\` ADD \`unknownAt\` datetime(3) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`send_attempts\` DROP COLUMN \`unknownAt\``);
        await queryRunner.query(`ALTER TABLE \`send_attempts\` DROP COLUMN \`runAt\``);
        await queryRunner.query(`DROP INDEX \`IDX_f0517eec3f63f617ee5138edeb\` ON \`jobs\``);
        await queryRunner.query(`DROP TABLE \`jobs\``);
    }

}
