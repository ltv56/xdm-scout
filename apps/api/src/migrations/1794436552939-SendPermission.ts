import { MigrationInterface, QueryRunner } from "typeorm";

export class SendPermission1794436552939 implements MigrationInterface {
    name = 'SendPermission1794436552939'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`contacts\` ADD \`invitationEventId\` varchar(32) NULL`);
        await queryRunner.query(`ALTER TABLE \`contacts\` ADD \`invitationAt\` datetime(3) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`contacts\` DROP COLUMN \`invitationAt\``);
        await queryRunner.query(`ALTER TABLE \`contacts\` DROP COLUMN \`invitationEventId\``);
    }

}
