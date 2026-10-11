import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGcRunsDecisionsAndArchive1791655313641 implements MigrationInterface {
  name = 'AddGcRunsDecisionsAndArchive1791655313641';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "gc_run" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "agentSessionId" uuid, "usageRecordId" uuid, "mode" character varying(8) NOT NULL, "ran" boolean NOT NULL, "applied" boolean NOT NULL, "failed" boolean NOT NULL, "error" character varying(100), "tokensBefore" integer, "tokensAfter" integer, "decisionCount" integer NOT NULL, "newDecisionCount" integer NOT NULL, "durationMs" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9fd37e0704ecd185b29022ed5d0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90f7340e9474cd489230a48606" ON "gc_run" ("agentSessionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85df6658c603be48be45c9b944" ON "gc_run" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gc_decision" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gcRunId" uuid NOT NULL, "agentSessionId" uuid NOT NULL, "itemKey" character varying(300) NOT NULL, "position" integer NOT NULL, "toolCallId" character varying(200), "toolName" character varying(200) NOT NULL, "contentHash" character(64) NOT NULL, "decision" character varying(16) NOT NULL, "reason" character varying(32) NOT NULL, "detail" character varying(300) NOT NULL, "tokensBefore" integer NOT NULL, "tokensAfter" integer NOT NULL, "replacement" text NOT NULL, "archiveId" character varying(40), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_36b13e684934272fb3830056271" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b6731b9f6241805c7834fdf80" ON "gc_decision" ("gcRunId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_35c52c012d9d4b3569e4e94c5c" ON "gc_decision" ("agentSessionId", "itemKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "archived_item" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "archiveId" character varying(40) NOT NULL, "toolName" character varying(200) NOT NULL, "contentHash" character(64) NOT NULL, "tokenCount" integer NOT NULL, "content" jsonb NOT NULL, "sizeBytes" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7a7da0865114603ea6b5b0db2fa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_36485dd38e753fbf8e86440de2" ON "archived_item" ("projectId", "archiveId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "gcMode" character varying(8) NOT NULL DEFAULT 'shadow'`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" ADD CONSTRAINT "FK_a1014c143f4d5767a4e39988137" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" ADD CONSTRAINT "FK_90f7340e9474cd489230a486063" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" ADD CONSTRAINT "FK_643a15b0859ea0a59eac709b1d8" FOREIGN KEY ("usageRecordId") REFERENCES "usage_record"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_decision" ADD CONSTRAINT "FK_0b6731b9f6241805c7834fdf806" FOREIGN KEY ("gcRunId") REFERENCES "gc_run"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_decision" ADD CONSTRAINT "FK_a6007824a5f17e73e1e7d6f4b6c" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "archived_item" ADD CONSTRAINT "FK_52a35d71d77315062f7fbe0e560" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "archived_item" DROP CONSTRAINT "FK_52a35d71d77315062f7fbe0e560"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_decision" DROP CONSTRAINT "FK_a6007824a5f17e73e1e7d6f4b6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_decision" DROP CONSTRAINT "FK_0b6731b9f6241805c7834fdf806"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" DROP CONSTRAINT "FK_643a15b0859ea0a59eac709b1d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" DROP CONSTRAINT "FK_90f7340e9474cd489230a486063"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" DROP CONSTRAINT "FK_a1014c143f4d5767a4e39988137"`,
    );
    await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "gcMode"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36485dd38e753fbf8e86440de2"`,
    );
    await queryRunner.query(`DROP TABLE "archived_item"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35c52c012d9d4b3569e4e94c5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b6731b9f6241805c7834fdf80"`,
    );
    await queryRunner.query(`DROP TABLE "gc_decision"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85df6658c603be48be45c9b944"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90f7340e9474cd489230a48606"`,
    );
    await queryRunner.query(`DROP TABLE "gc_run"`);
  }
}
