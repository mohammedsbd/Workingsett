import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectGcSettings1791725005289 implements MigrationInterface {
  name = 'AddProjectGcSettings1791725005289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcMinContextTokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcBatchTokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcProtectedTurns" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcArchiveMinTokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcArchiveAfterTurns" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcSideEffectTools" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcSideEffectTools"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcArchiveAfterTurns"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcArchiveMinTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcProtectedTurns"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcBatchTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "gcMinContextTokens"`,
    );
  }
}
