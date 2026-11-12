import { MigrationInterface, QueryRunner } from "typeorm";

export class Budget1794424699354 implements MigrationInterface {
    name = 'Budget1794424699354'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`x_posts\` (\`postId\` varchar(32) NOT NULL, \`xUserId\` varchar(32) NOT NULL, \`text\` text NOT NULL, \`postedAt\` datetime(3) NOT NULL, \`fetchedAt\` datetime(3) NOT NULL, INDEX \`IDX_e5d7f169397d8d32d328534829\` (\`xUserId\`), PRIMARY KEY (\`postId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`api_usage\` (\`id\` int NOT NULL AUTO_INCREMENT, \`campaignId\` int NOT NULL, \`kind\` varchar(16) NOT NULL, \`count\` int NOT NULL, \`costMicros\` int NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_bddf2ec0e1e59a0de0826b1b5d\` (\`campaignId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`campaigns\` ADD \`budgetMicros\` int NOT NULL DEFAULT '1000000'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaigns\` DROP COLUMN \`budgetMicros\``);
        await queryRunner.query(`DROP INDEX \`IDX_bddf2ec0e1e59a0de0826b1b5d\` ON \`api_usage\``);
        await queryRunner.query(`DROP TABLE \`api_usage\``);
        await queryRunner.query(`DROP INDEX \`IDX_e5d7f169397d8d32d328534829\` ON \`x_posts\``);
        await queryRunner.query(`DROP TABLE \`x_posts\``);
    }

}
