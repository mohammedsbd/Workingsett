# NestJS REST API boilerplate 🇺🇦

[![image](https://github.com/brocoders/nestjs-boilerplate/assets/72293912/197da43e-02f4-4895-8d3e-b7a42a591c26)](https://github.com/new?template_name=nestjs-boilerplate&template_owner=brocoders)

[![renovate](https://img.shields.io/badge/renovate-enabled-%231A1F6C?logo=renovatebot)](https://app.renovatebot.com/dashboard)
[![Static Badge](https://img.shields.io/badge/supported_by-brocoders-d91965?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTMwIiBoZWlnaHQ9IjE4NyIgdmlld0JveD0iMCAwIDEzMCAxODciIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BCjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF83NzExXzQ4OTEpIj4KPHBhdGggZD0iTTc1Ljk5NjcgNDUuNzUwNkM2NS4xMDg5IDQ2Ljg2MSA1Ny45MjMgNTguNDA5NyA2Mi4yNzgxIDY4Ljg0OEwxMDguNDQyIDE4N0w3My42MDEzIDE1NS4wMTlIMzQuODQwOUMyMC42ODY4IDE1NS4wMTkgOS4zNjM0OSAxNDMuNDcgOS4zNjM0OSAxMjkuMDM0Vjk0LjYxMDVDOS4zNjM0OSA5Mi4xNjc1IDguNDkyNDYgODkuNzI0NSA2Ljc1MDQyIDg3Ljk0NzdMMCA4MS4wNjNMNi43NTA0MiA3NC4xNzgxQzguNDkyNDYgNzIuNDAxNCA5LjM2MzQ5IDY5Ljk1ODQgOS4zNjM0OSA2Ny41MTU0VjMxLjA5MjZDOS4zNjM0OSAxMy43Njk2IDIzLjA4MjEgMCAzOS44NDkyIDBINTguMTQwN0w3NS45OTY3IDQ1Ljc1MDZaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMTI1LjY0NiAxMTIuMzc4Vjk0LjgzMjdDMTI1LjY0NiA5My43MjIyIDEyNi4wODEgOTIuNjExOCAxMjYuOTUyIDkxLjcyMzRMMTMwLjAwMSA4OC4zOTIxTDEyNi45NTIgODUuMDYwN0MxMjYuMDgxIDg0LjE3MjQgMTI1LjY0NiA4My4wNjE5IDEyNS42NDYgODEuOTUxNFY2OS43MzY1QzEyNS42NDYgNTYuNDExMSAxMTQuOTc2IDQ1Ljc1MDcgMTAyLjEyOCA0NS43NTA3SDc1Ljk5NzNMMTA1LjYxMiAxMzAuODExQzEwNS42MTIgMTMwLjgxMSAxMTAuNjIgMTMwLjgxMSAxMTAuODM4IDEzMC44MTFDMTE5LjExMyAxMjkuMDM1IDEyNS42NDYgMTIxLjQ4NCAxMjUuNjQ2IDExMi4zNzhaIiBmaWxsPSJ3aGl0ZSIvPgo8L2c%2BCjxkZWZzPgo8Y2xpcFBhdGggaWQ9ImNsaXAwXzc3MTFfNDg5MSI%2BCjxyZWN0IHdpZHRoPSIxMzAiIGhlaWdodD0iMTg3IiBmaWxsPSJ3aGl0ZSIvPgo8L2NsaXBQYXRoPgo8L2RlZnM%2BCjwvc3ZnPgo%3D&logoColor=d91965)](https://brocoders.com/)
[![Discord Badge](https://img.shields.io/badge/discord-NodeJS_boilerplate-d91965?style=flat&labelColor=5866f2&logo=discord&logoColor=white&link=https://discord.com/channels/520622812742811698/1197293125434093701)](https://discord.com/channels/520622812742811698/1197293125434093701)

<br />
<p align="center"><a href="https://discord.com/channels/520622812742811698/1197293125434093701"><img src="https://github.com/brocoders/nestjs-boilerplate/assets/72293912/c9d5fbf0-b56d-46b5-bb30-f96f44764bae" width="300"/></a></p>
<br />

## Description <!-- omit in toc -->

NestJS REST API boilerplate for a typical project

[Full documentation here](/docs/readme.md)

Demo: <https://nestjs-boilerplate-test.herokuapp.com/docs>

A fully compatible frontend boilerplate: <https://github.com/brocoders/extensive-react-boilerplate>

Belongs to the [bc boilerplates](https://bcboilerplates.com/) ecosystem

<https://github.com/user-attachments/assets/a66f114a-c714-4036-8eeb-20cbf04ae985>

## Table of Contents <!-- omit in toc -->

- [Use the proxy](#use-the-proxy)
- [Features](#features)
- [Contributors](#contributors)
- [Support](#support)

## Use the proxy

Parsim serves an OpenAI-compatible endpoint at `POST /v1/chat/completions` and the Anthropic Messages API at `POST /v1/messages` (no `/api` prefix). OpenAI SDKs work with `baseURL` set to `http://localhost:3001/v1`, Anthropic SDKs and tools with `ANTHROPIC_BASE_URL=http://localhost:3001`. Each project forwards to OpenAI, Gemini (through its OpenAI-compatible endpoint) or Anthropic. See [docs/proxy.md](docs/proxy.md) for details.

### 1. Create a project and a Parsim key

Log in as the seeded admin, create a project, then create a key. The full key is shown only once.

```bash
TOKEN=$(curl -s http://localhost:3001/api/v1/auth/email/login -H "content-type: application/json" -d '{"email":"admin@example.com","password":"secret"}' | node -p "JSON.parse(require('fs').readFileSync(0)).token")
```

```bash
curl -s http://localhost:3001/api/v1/projects -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"My agent","upstream":"gemini"}'
```

```bash
curl -s http://localhost:3001/api/v1/projects/<projectId>/api-keys -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"local"}'
```

Set `"upstream":"openai"` for OpenAI or `"upstream":"anthropic"` for Anthropic. To store your provider key on the project (encrypted, never returned), add `"providerKey":"..."`; you can then leave it out of requests.

### 2. Send requests with curl

The Parsim key goes in `x-parsim-key` (or as the bearer token); your provider key goes in `x-provider-key` (or as the bearer token when the Parsim key is in `x-parsim-key`).

```bash
curl http://localhost:3001/v1/chat/completions -H "content-type: application/json" -H "x-parsim-key: psm_..." -H "x-provider-key: $GEMINI_API_KEY" -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"Hello"}]}'
```

For an OpenAI project, use your OpenAI key in `x-provider-key` and an OpenAI model such as `gpt-5-mini`. Add `"stream":true` to stream.

### 3. Use the OpenAI SDK

OpenAI upstream:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3001/v1',
  apiKey: process.env.PARSIM_KEY, // psm_...
  defaultHeaders: { 'x-provider-key': process.env.OPENAI_API_KEY! },
});

const reply = await client.chat.completions.create({
  model: 'gpt-5-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

Gemini upstream (project created with `"upstream":"gemini"`):

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3001/v1',
  apiKey: process.env.GEMINI_API_KEY, // provider key as the bearer token
  defaultHeaders: { 'x-parsim-key': process.env.PARSIM_KEY! },
});

const stream = await client.chat.completions.create({
  model: 'gemini-3.8-flash',
  stream: true,
  messages: [{ role: 'user', content: 'Hello' }],
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

### 4. Use the Anthropic SDK or Claude Code

Create a project with `"upstream":"anthropic"`. The simplest setup stores your Anthropic key on the project and uses the Parsim key as the API key, which also works for tools that only let you set `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`:

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3001',
  apiKey: process.env.PARSIM_KEY, // psm_...; the Anthropic key is stored on the project
});

const message = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello' }],
});
```

To keep your Anthropic key off the server, send it per request instead: `defaultHeaders: { 'x-provider-key': process.env.ANTHROPIC_API_KEY! }`.

For Claude Code, set `ANTHROPIC_BASE_URL=http://localhost:3001` and `ANTHROPIC_API_KEY=psm_...` before running `claude`. See [Using Claude Code through Parsim](docs/proxy.md#using-claude-code-through-parsim).

Every request is recorded in `usage_record` with token counts, cost from [config/model-prices.json](config/model-prices.json) and latency, never with prompt or response content. Anthropic cache reads and cache writes are recorded and priced separately.

## Features

- [x] Database. PostgreSQL with [TypeORM](https://www.npmjs.com/package/typeorm).
- [x] Seeding.
- [x] Config Service ([@nestjs/config](https://www.npmjs.com/package/@nestjs/config)).
- [x] Mailing ([nodemailer](https://www.npmjs.com/package/nodemailer)).
- [x] Sign in and sign up via email.
- [x] Social sign in (Apple, Facebook, Google).
- [x] Admin and User roles.
- [x] Internationalization/Translations (I18N) ([nestjs-i18n](https://www.npmjs.com/package/nestjs-i18n)).
- [x] File uploads. Support local and Amazon S3 drivers.
- [x] Swagger.
- [x] E2E and units tests.
- [x] CI (Github Actions).

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Shchepotin"><img src="https://avatars.githubusercontent.com/u/6001723?v=4?s=100" width="100px;" alt="Vladyslav Shchepotin"/><br /><sub><b>Vladyslav Shchepotin</b></sub></a><br /><a href="#maintenance-Shchepotin" title="Maintenance">🚧</a> <a href="#doc-Shchepotin" title="Documentation">📖</a> <a href="#code-Shchepotin" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SergeiLomako"><img src="https://avatars.githubusercontent.com/u/31205374?v=4?s=100" width="100px;" alt="SergeiLomako"/><br /><sub><b>SergeiLomako</b></sub></a><br /><a href="#code-SergeiLomako" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ElenVlass"><img src="https://avatars.githubusercontent.com/u/72293912?v=4?s=100" width="100px;" alt="Elena Vlasenko"/><br /><sub><b>Elena Vlasenko</b></sub></a><br /><a href="#doc-ElenVlass" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://brocoders.com"><img src="https://avatars.githubusercontent.com/u/226194?v=4?s=100" width="100px;" alt="Rodion"/><br /><sub><b>Rodion</b></sub></a><br /><a href="#business-sars" title="Business development">💼</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## Support

If you seek consulting, support, or wish to collaborate, please contact us via [boilerplates@brocoders.com](mailto:boilerplates@brocoders.com). For any inquiries regarding boilerplates, feel free to ask on [GitHub Discussions](https://github.com/brocoders/nestjs-boilerplate/discussions) or [Discord](https://discord.com/channels/520622812742811698/1197293125434093701).
