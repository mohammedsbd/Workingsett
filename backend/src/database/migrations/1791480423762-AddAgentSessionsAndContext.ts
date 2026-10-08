import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentSessionsAndContext1791480423762 implements MigrationInterface {
  name = 'AddAgentSessionsAndContext1791480423762';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "agent_session" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "externalId" character varying(200) NOT NULL, "idSource" character varying(16) NOT NULL, "provider" character varying NOT NULL, "model" character varying NOT NULL, "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "requestCount" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_5b8bdf54e8520f352257f5d2633" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_569f86b565f67d6af714b06d69" ON "agent_session" ("projectId", "lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8a51acb9432ceba4b327c8c0fd" ON "agent_session" ("projectId", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "context_item" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "agentSessionId" uuid NOT NULL, "position" integer NOT NULL, "role" character varying(16) NOT NULL, "kind" character varying(16) NOT NULL, "toolCallId" character varying(200), "contentHash" character(64) NOT NULL, "tokenCount" integer NOT NULL, "tokenizer" character varying(40) NOT NULL, "firstSeenRequest" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1062bfd06bde9db40f1a41db020" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f5ca09800e068d9d97eb16bd8" ON "context_item" ("contentHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1a076397f6ef61410551c79f84" ON "context_item" ("agentSessionId", "position", "contentHash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "context_content" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "projectId" uuid NOT NULL, "hash" character(64) NOT NULL, "content" jsonb NOT NULL, "sizeBytes" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fd946e27a7e4cfe29c4009b980d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e8979f760d1903d18df72c7400" ON "context_content" ("projectId", "hash") `,
    );
    await queryRunner.query(`ALTER TABLE "project" ADD "storeContent" boolean`);
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD "agentSessionId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e92794f1169e96a2e76bea4a9" ON "usage_record" ("agentSessionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_session" ADD CONSTRAINT "FK_5a1130dd357ca39d278fb7ea69a" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" ADD CONSTRAINT "FK_2e92794f1169e96a2e76bea4a99" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "context_item" ADD CONSTRAINT "FK_8367a2d39e92e90606d12081db8" FOREIGN KEY ("agentSessionId") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "context_content" ADD CONSTRAINT "FK_06f946549c7c7c40d18de0968ef" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "context_content" DROP CONSTRAINT "FK_06f946549c7c7c40d18de0968ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "context_item" DROP CONSTRAINT "FK_8367a2d39e92e90606d12081db8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" DROP CONSTRAINT "FK_2e92794f1169e96a2e76bea4a99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_session" DROP CONSTRAINT "FK_5a1130dd357ca39d278fb7ea69a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e92794f1169e96a2e76bea4a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_record" DROP COLUMN "agentSessionId"`,
    );
    await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "storeContent"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8979f760d1903d18df72c7400"`,
    );
    await queryRunner.query(`DROP TABLE "context_content"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a076397f6ef61410551c79f84"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f5ca09800e068d9d97eb16bd8"`,
    );
    await queryRunner.query(`DROP TABLE "context_item"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a51acb9432ceba4b327c8c0fd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_569f86b565f67d6af714b06d69"`,
    );
    await queryRunner.query(`DROP TABLE "agent_session"`);
  }
}
