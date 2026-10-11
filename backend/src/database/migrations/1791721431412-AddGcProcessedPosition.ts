import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGcProcessedPosition1791721431412 implements MigrationInterface {
  name = 'AddGcProcessedPosition1791721431412';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_session" ADD "gcProcessedPosition" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_session" DROP COLUMN "gcProcessedPosition"`,
    );
  }
}
