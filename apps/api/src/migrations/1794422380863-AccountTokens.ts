import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountTokens1794422380863 implements MigrationInterface {
    name = 'AccountTokens1794422380863'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` ADD \`accessTokenEnc\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` ADD \`refreshTokenEnc\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` ADD \`tokenExpiresAt\` datetime(3) NULL`);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` ADD \`scope\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` DROP COLUMN \`scope\``);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` DROP COLUMN \`tokenExpiresAt\``);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` DROP COLUMN \`refreshTokenEnc\``);
        await queryRunner.query(`ALTER TABLE \`sender_accounts\` DROP COLUMN \`accessTokenEnc\``);
    }

}
