import { MigrationInterface, QueryRunner } from "typeorm";

export class SendLedger1794422364213 implements MigrationInterface {
    name = 'SendLedger1794422364213'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`sender_accounts\` (\`id\` int NOT NULL AUTO_INCREMENT, \`xUserId\` varchar(32) NOT NULL, \`handle\` varchar(64) NOT NULL, UNIQUE INDEX \`IDX_c4b55191ebadd91332f6cf0bae\` (\`xUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`x_users\` (\`xUserId\` varchar(32) NOT NULL, \`handle\` varchar(64) NOT NULL, PRIMARY KEY (\`xUserId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`contacts\` (\`id\` int NOT NULL AUTO_INCREMENT, \`senderAccountId\` int NOT NULL, \`xUserId\` varchar(32) NOT NULL, \`relationshipContext\` varchar(16) NOT NULL DEFAULT 'cold', \`recipientPermission\` varchar(16) NOT NULL DEFAULT 'none', \`activeAttemptId\` int NULL, UNIQUE INDEX \`IDX_802e9405e4cd059d700d706575\` (\`senderAccountId\`, \`xUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`drafts\` (\`id\` int NOT NULL AUTO_INCREMENT, \`contactId\` int NOT NULL, \`content\` text NOT NULL, \`status\` varchar(16) NOT NULL DEFAULT 'pending', \`approvedHash\` char(64) NULL, INDEX \`IDX_f734914530ca409550483f0cc1\` (\`contactId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`send_attempts\` (\`id\` int NOT NULL AUTO_INCREMENT, \`contactId\` int NOT NULL, \`draftId\` int NOT NULL, \`route\` varchar(8) NOT NULL DEFAULT 'api', \`status\` varchar(24) NOT NULL DEFAULT 'queued', \`contentHash\` char(64) NOT NULL, \`xConversationId\` varchar(64) NULL, \`xEventId\` varchar(32) NULL, \`error\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_20d3942f032ce2046a85d4815d\` (\`contactId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`do_not_contact\` (\`xUserId\` varchar(32) NOT NULL, \`reason\` varchar(255) NOT NULL, \`source\` varchar(32) NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`xUserId\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`do_not_contact\``);
        await queryRunner.query(`DROP INDEX \`IDX_20d3942f032ce2046a85d4815d\` ON \`send_attempts\``);
        await queryRunner.query(`DROP TABLE \`send_attempts\``);
        await queryRunner.query(`DROP INDEX \`IDX_f734914530ca409550483f0cc1\` ON \`drafts\``);
        await queryRunner.query(`DROP TABLE \`drafts\``);
        await queryRunner.query(`DROP INDEX \`IDX_802e9405e4cd059d700d706575\` ON \`contacts\``);
        await queryRunner.query(`DROP TABLE \`contacts\``);
        await queryRunner.query(`DROP TABLE \`x_users\``);
        await queryRunner.query(`DROP INDEX \`IDX_c4b55191ebadd91332f6cf0bae\` ON \`sender_accounts\``);
        await queryRunner.query(`DROP TABLE \`sender_accounts\``);
    }

}
