import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecallsAndUpstreamCalls1791717740738 implements MigrationInterface {
  name = 'AddRecallsAndUpstreamCalls1791717740738';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "recall" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "agentSessionId" uuid, "usageRecordId" uuid, "archiveId" character varying(100) NOT NULL, "found" boolean NOT NULL, "refused" boolean NOT NULL, "tokensRestored" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_93db2feecc1f9bbf8c9fdd6d744" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_637945a94aae39d2fc8c5a82f3" ON "recall" ("usageRecordId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4f7ee581fc4570972333b5f55" ON "recall" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD "upstreamCalls" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "recall" ADD CONSTRAINT "FK_e84d2003c747eb07da770aa1e7e" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recall" ADD CONSTRAINT "FK_5df564c5cefa7986ea3294a8ad1" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recall" ADD CONSTRAINT "FK_637945a94aae39d2fc8c5a82f36" FOREIGN KEY ("usageRecordId") REFERENCES "usage_record"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recall" DROP CONSTRAINT "FK_637945a94aae39d2fc8c5a82f36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recall" DROP CONSTRAINT "FK_5df564c5cefa7986ea3294a8ad1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recall" DROP CONSTRAINT "FK_e84d2003c747eb07da770aa1e7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" DROP COLUMN "upstreamCalls"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4f7ee581fc4570972333b5f55"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_637945a94aae39d2fc8c5a82f3"`,
    );
    await queryRunner.query(`DROP TABLE "recall"`);
  }
}
