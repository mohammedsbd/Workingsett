import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProxyTables1791301311631 implements MigrationInterface {
  name = 'CreateProxyTables1791301311631';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "project" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "upstream" character varying NOT NULL, "ownerId" integer NOT NULL, "providerKeyEncrypted" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4d68b1358bb5b766d3e78f32f57" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9884b2ee80eb70b7db4f12e8ae" ON "project" ("ownerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "usage_record" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "upstream" character varying NOT NULL, "model" character varying NOT NULL, "inputTokens" integer NOT NULL, "outputTokens" integer NOT NULL, "cachedInputTokens" integer, "costUsd" numeric(18,8), "latencyMs" integer NOT NULL, "status" integer NOT NULL, "streamed" boolean NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f22cc039acc8b1bd333978b7cf7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_012fdaeb490cb44f1a0034067b" ON "usage_record" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "parsim_api_key" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "name" character varying, "prefix" character varying NOT NULL, "keyHash" character varying NOT NULL, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_43eedb4b360f45ab68c4794472f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9a5af0173947e531728567081" ON "parsim_api_key" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3cdcacdb353a371521a8e673c6" ON "parsim_api_key" ("keyHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD CONSTRAINT "FK_9884b2ee80eb70b7db4f12e8aed" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD CONSTRAINT "FK_81d0b63411ed8ccdcf106815d33" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "parsim_api_key" ADD CONSTRAINT "FK_e9a5af0173947e5317285670811" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "parsim_api_key" DROP CONSTRAINT "FK_e9a5af0173947e5317285670811"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" DROP CONSTRAINT "FK_81d0b63411ed8ccdcf106815d33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP CONSTRAINT "FK_9884b2ee80eb70b7db4f12e8aed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3cdcacdb353a371521a8e673c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9a5af0173947e531728567081"`,
    );
    await queryRunner.query(`DROP TABLE "parsim_api_key"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_012fdaeb490cb44f1a0034067b"`,
    );
    await queryRunner.query(`DROP TABLE "usage_record"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9884b2ee80eb70b7db4f12e8ae"`,
    );
    await queryRunner.query(`DROP TABLE "project"`);
  }
}
