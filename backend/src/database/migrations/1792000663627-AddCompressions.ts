import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompressions1792000663627 implements MigrationInterface {
  name = 'AddCompressions1792000663627';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "compression" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "agentSessionId" uuid NOT NULL, "stretchKey" character(64) NOT NULL, "startIndex" integer NOT NULL, "endIndex" integer NOT NULL, "firstTurn" integer NOT NULL, "lastTurn" integer NOT NULL, "status" character varying(16) NOT NULL, "input" jsonb, "stateBlock" text, "tokensBefore" integer NOT NULL, "tokensAfter" integer, "usageRecordId" uuid, "error" character varying(100), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "readyAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8b3bc4530231ef26ddbede6f0b4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41ad592e1af218d0397818e1bf" ON "compression" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_59993f447ccb42b97aace6dcf1" ON "compression" ("agentSessionId", "stretchKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "compressionEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "compressionKeySource" character varying(8) NOT NULL DEFAULT 'parsim'`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" ADD "compressionModel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD "kind" character varying(16) NOT NULL DEFAULT 'proxy'`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" ADD "compressionSavedTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "compression" ADD CONSTRAINT "FK_41ad592e1af218d0397818e1bf1" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "compression" ADD CONSTRAINT "FK_d7a11513b408c4288221f51f4d9" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "compression" ADD CONSTRAINT "FK_21ff1945a93d9bb57059f0754d7" FOREIGN KEY ("usageRecordId") REFERENCES "usage_record"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compression" DROP CONSTRAINT "FK_21ff1945a93d9bb57059f0754d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compression" DROP CONSTRAINT "FK_d7a11513b408c4288221f51f4d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compression" DROP CONSTRAINT "FK_41ad592e1af218d0397818e1bf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gc_run" DROP COLUMN "compressionSavedTokens"`,
    );
    await queryRunner.query(`ALTER TABLE "usage_record" DROP COLUMN "kind"`);
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "compressionModel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "compressionKeySource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "compressionEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59993f447ccb42b97aace6dcf1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41ad592e1af218d0397818e1bf"`,
    );
    await queryRunner.query(`DROP TABLE "compression"`);
  }
}
