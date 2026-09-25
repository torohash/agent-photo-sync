import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { receiverPorts } from "../packages/core/src/host.ts";
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

void test("使用中のポートを飛ばして、候補の次のポートで待ち受ける", async (t) => {
  const listening = async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
  };
  const busy = await listening();
  const free = await listening();
  const ports = [busy, free].map((server) => (server.address() as AddressInfo).port);
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), "photosync-port-"));
  const receiver = new PhotoReceiver({
    id: "port-test",
    host: "127.0.0.1",
    ports,
    webOrigin: undefined,
    inbox: new PhotoInbox(),
    selection: new ReceiverSelection(directory),
    identity: async () => { throw new Error("未使用"); },
    peers: () => [],
    onPhoto: () => {},
    onError: (error) => { throw error; },
  });
  t.after(async () => {
    await receiver.close();
    busy.close();
    await rm(directory, { recursive: true });
  });
  await receiver.start();
  assert.equal(receiver.port, ports[1]);
  assert.equal((await fetch(`http://127.0.0.1:${ports[1]}/v1/peers`)).status, 200);
});

void test("PHOTOSYNC_PORT_RANGEで受信ポートの範囲を変更できる", () => {
  const previous = process.env.PHOTOSYNC_PORT_RANGE;
  try {
    delete process.env.PHOTOSYNC_PORT_RANGE;
    assert.deepEqual([receiverPorts()[0], receiverPorts().at(-1)], [47800, 47819]);
    process.env.PHOTOSYNC_PORT_RANGE = "50000-50002";
    assert.deepEqual(receiverPorts(), [50000, 50001, 50002]);
    process.env.PHOTOSYNC_PORT_RANGE = "50002-50000";
    assert.throws(() => receiverPorts(), /PHOTOSYNC_PORT_RANGE/);
  } finally {
    if (previous === undefined) delete process.env.PHOTOSYNC_PORT_RANGE;
    else process.env.PHOTOSYNC_PORT_RANGE = previous;
  }
});
