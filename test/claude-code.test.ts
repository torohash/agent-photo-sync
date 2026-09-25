import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

void test("Claude Code用MCPサーバーが受信した写真をget_photosで一度だけ返す", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "photosync-claude-"));
  // Claude Codeと同じく、TypeScriptをNode.jsで直接起動する。
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../packages/claude-code/src/server.ts", import.meta.url).pathname],
    env: {
      ...(process.env as Record<string, string>),
      XDG_STATE_HOME: state,
      CLAUDE_PID: String(process.pid),
      CLAUDE_CODE_SESSION_ID: "claude-session",
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await rm(state, { recursive: true });
  });

  const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    (result.content as { type: string; text?: string }[])[0]!.text!;
  const statusText = text(await client.callTool({ name: "photosync_status" }));
  const url = statusText.match(/Web確認用: (\S+)/)![1]!;
  const status = await (await fetch(`${url}/v1/status`)).json();
  assert.equal(status.agent, "claude-code");
  assert.equal(status.sessionId, "claude-session");

  const image = await readFile(new URL("./fixtures/photo.png", import.meta.url));
  const posted = await fetch(`${url}/v1/photos/${status.id}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: image,
  });
  assert.equal((await posted.json()).pending, 1);

  const photos = await client.callTool({ name: "get_photos" });
  assert.deepEqual((photos.content as unknown[]).slice(1), [
    { type: "image", data: image.toString("base64"), mimeType: "image/png" },
  ]);
  assert.match(text(await client.callTool({ name: "get_photos" })), /未取得の写真はありません/);
  assert.equal((await (await fetch(`${url}/v1/status`)).json()).pending, 0);

  await client.callTool({ name: "photosync_receive" });
  assert.equal(
    await readFile(join(state, "agent-photosync", "selected-receiver"), "utf8"),
    status.id,
  );
});
