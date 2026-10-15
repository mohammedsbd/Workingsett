import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReplays1792054697560 implements MigrationInterface {
  name = 'AddReplays1792054697560';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "snapshot_part" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "hash" character(64) NOT NULL, "json" text NOT NULL, "sizeBytes" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8a569c39a0e295f975fb4959091" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9d10dfc184ffd37adf8671f55b" ON "snapshot_part" ("projectId", "hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "request_snapshot" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "agentSessionId" uuid NOT NULL, "requestNumber" integer NOT NULL, "usageRecordId" uuid, "api" character varying(32) NOT NULL, "model" character varying(255) NOT NULL, "streamed" boolean NOT NULL, "original" jsonb NOT NULL, "gc" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e600b9e12c3c625a04ebb7ca499" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_495b1f76095b3c81fdff5030b0" ON "request_snapshot" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5b5d7d5aaa0b98c4c029c9400c" ON "request_snapshot" ("agentSessionId", "requestNumber") `,
    );
    await queryRunner.query(
      `CREATE TABLE "replay" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "agentSessionId" uuid NOT NULL, "status" character varying(16) NOT NULL, "requestNumbers" jsonb NOT NULL, "budgetUsd" numeric(18,8) NOT NULL, "estimatedCostUsd" numeric(18,8) NOT NULL, "spentUsd" numeric(18,8) NOT NULL DEFAULT '0', "judgeKeySource" character varying(8) NOT NULL, "judgeProvider" character varying(16) NOT NULL, "judgeModel" character varying(100) NOT NULL, "pointsDone" integer NOT NULL DEFAULT '0', "error" character varying(200), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f8deb77a142176bd7078cdd2093" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_65e2cc40e38b753d4c6d219815" ON "replay" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3137ce1a38148cb3794805b824" ON "replay" ("agentSessionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "replay_result" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "replayId" uuid NOT NULL, "requestNumber" integer NOT NULL, "status" character varying(16) NOT NULL, "gcChanged" boolean NOT NULL, "original" jsonb, "gc" jsonb, "exactMatch" boolean, "toolCallsMatch" boolean, "judgeScore" smallint, "judgeReason" character varying(500), "judgeCostUsd" numeric(18,8) NOT NULL DEFAULT '0', "agreed" boolean, "error" character varying(200), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_03aaec11fd0c9ad70c6e48c8dac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f1533fc22a7bf6e8686474e4d4" ON "replay_result" ("replayId", "requestNumber") `,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "replayJudgeKeySource" character varying(8) NOT NULL DEFAULT 'parsim'`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "replayJudgeModel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "snapshot_part" ADD CONSTRAINT "FK_4febc892ec8c4140c8774f4617c" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" ADD CONSTRAINT "FK_495b1f76095b3c81fdff5030b06" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" ADD CONSTRAINT "FK_e0eab95d29ee9f7fecb67153906" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" ADD CONSTRAINT "FK_02e0c05091284699570ed5740eb" FOREIGN KEY ("usageRecordId") REFERENCES "usage_record"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "replay" ADD CONSTRAINT "FK_65e2cc40e38b753d4c6d2198155" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "replay" ADD CONSTRAINT "FK_3137ce1a38148cb3794805b8243" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "replay_result" ADD CONSTRAINT "FK_0eedb622cca1038e06bc5e695ae" FOREIGN KEY ("replayId") REFERENCES "replay"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "replay_result" DROP CONSTRAINT "FK_0eedb622cca1038e06bc5e695ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "replay" DROP CONSTRAINT "FK_3137ce1a38148cb3794805b8243"`,
    );
    await queryRunner.query(
      `ALTER TABLE "replay" DROP CONSTRAINT "FK_65e2cc40e38b753d4c6d2198155"`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" DROP CONSTRAINT "FK_02e0c05091284699570ed5740eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" DROP CONSTRAINT "FK_e0eab95d29ee9f7fecb67153906"`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_snapshot" DROP CONSTRAINT "FK_495b1f76095b3c81fdff5030b06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "snapshot_part" DROP CONSTRAINT "FK_4febc892ec8c4140c8774f4617c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "replayJudgeModel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "replayJudgeKeySource"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1533fc22a7bf6e8686474e4d4"`,
    );
    await queryRunner.query(`DROP TABLE "replay_result"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3137ce1a38148cb3794805b824"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_65e2cc40e38b753d4c6d219815"`,
    );
    await queryRunner.query(`DROP TABLE "replay"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b5d7d5aaa0b98c4c029c9400c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_495b1f76095b3c81fdff5030b0"`,
    );
    await queryRunner.query(`DROP TABLE "request_snapshot"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d10dfc184ffd37adf8671f55b"`,
    );
    await queryRunner.query(`DROP TABLE "snapshot_part"`);
  }
}
