import { MigrationInterface, QueryRunner } from "typeorm";

export class ReviewSignals1794481028208 implements MigrationInterface {
    name = 'ReviewSignals1794481028208'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`review_signals\` (\`id\` int NOT NULL AUTO_INCREMENT, \`action\` varchar(16) NOT NULL, \`reason\` varchar(24) NULL, \`note\` text NULL, \`originalText\` text NOT NULL, \`finalText\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`drafts\` ADD \`originalContent\` text NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`drafts\` DROP COLUMN \`originalContent\``);
        await queryRunner.query(`DROP TABLE \`review_signals\``);
    }

}
