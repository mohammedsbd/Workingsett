import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsageCacheWriteTokens1791307920028 implements MigrationInterface {
  name = 'AddUsageCacheWriteTokens1791307920028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD "cacheWriteInputTokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usage_record" DROP COLUMN "cacheWriteInputTokens"`,
    );
  }
}
