import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1794411315206 implements MigrationInterface {
    name = 'Init1794411315206'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`settings\` (\`key\` varchar(191) NOT NULL, \`value\` json NOT NULL, PRIMARY KEY (\`key\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`settings\``);
    }

}
