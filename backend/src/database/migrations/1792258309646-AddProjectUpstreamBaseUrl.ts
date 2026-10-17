import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectUpstreamBaseUrl1792258309646 implements MigrationInterface {
  name = 'AddProjectUpstreamBaseUrl1792258309646';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" ADD "upstreamBaseUrl" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "upstreamBaseUrl"`,
    );
  }
}
