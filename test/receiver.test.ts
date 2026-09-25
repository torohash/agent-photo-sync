import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhotoInbox } from "../packages/core/src/inbox.ts";
import { PhotoReceiver } from "../packages/core/src/receiver.ts";
import { ReceiverSelection } from "../packages/core/src/selection.ts";

void test("同じフォルダのPiへ個別に送信でき、Pi側の受信先指定も切り替えられる", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "photosync-test-"));
  const selection = new ReceiverSelection(directory);
  const inboxes = [new PhotoInbox(), new PhotoInbox()];
  let notifications = 0;
  const receivers: PhotoReceiver[] = inboxes.map(
    (inbox, index) =>
      new PhotoReceiver({
        id: `receiver-${index}`,
        host: "127.0.0.1",
        webOrigin: "http://127.0.0.1:8080",
        inbox,
        selection,
        identity: async () => ({
          agent: "pi",
          hostId: "test-host",
          host: "test-pc",
          cwd: "/work/same-project",
          project: "same-project",
          pid: 100 + index,
          terminal: `/dev/pts/${index}`,
          sessionId: `session-${index}`,
          sessionName: null,
          model: null,
          herdr: null,
        }),
        peers: () =>
          receivers.map((receiver, i) => ({
            id: `receiver-${i}`,
            url: `http://127.0.0.1:${receiver.port}`,
          })),
        onPhoto: () => notifications++,
        onError: (error) => { throw error; },
      }),
  );
  await Promise.all(receivers.map((receiver) => receiver.start()));
  t.after(async () => {
    await Promise.all(receivers.map((receiver) => receiver.close()));
    await rm(directory, { recursive: true });
  });
  const urls = receivers.map((receiver) => `http://127.0.0.1:${receiver.port}`);
  const image = await readFile(
    new URL("./fixtures/photo.png", import.meta.url),
  );
  const post = (index: number, id: string) =>
    fetch(`${urls[index]}/v1/photos/${id}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: image,
    });

  assert.equal((await post(1, "receiver-1")).status, 200);
  assert.equal(inboxes[0].pending.length, 0);
  assert.equal(inboxes[1].pending.length, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(Buffer.from(inboxes[1].pending[0].data, "base64"), image);
  assert.equal((await receivers[1].status()).pending, 1);
  assert.equal((await post(1, "receiver-0")).status, 404);
  assert.equal(inboxes[1].pending.length, 1);

  await selection.select("receiver-0");
  assert.equal((await receivers[0].status()).preferred, true);
  await selection.select("receiver-1");
  assert.equal((await receivers[0].status()).preferred, false);
  assert.equal((await receivers[1].status()).preferred, true);
  assert.equal((await (await fetch(`${urls[0]}/v1/peers`)).json()).length, 2);

  const preflight = await fetch(`${urls[0]}/v1/photos/receiver-0`, {
    method: "OPTIONS",
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:8080",
  );
  assert.equal(inboxes[1].take().length, 1);
  assert.equal(inboxes[1].take().length, 0);
});
