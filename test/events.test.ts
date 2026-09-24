import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { PhotoInbox } from "../packages/pi-extension/src/inbox.ts";
import { PhotoReceiver } from "../packages/pi-extension/src/receiver.ts";
import { ReceiverSelection } from "../packages/pi-extension/src/selection.ts";
import type { PeerEndpoint, ReceiverStatus } from "../packages/pi-extension/src/protocol.ts";

type WireEvent = { type: string; data: { receiver?: ReceiverStatus; peers?: PeerEndpoint[]; id?: string } & Partial<ReceiverStatus> };

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "SSE通知が届くこと");
    await setTimeout(10);
  }
}

async function collect(response: Response, events: WireEvent[]): Promise<void> {
  let buffer = "";
  for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const [event, data] = buffer.slice(0, boundary).split("\n");
      buffer = buffer.slice(boundary + 2);
      // JSONの不正はテストの失敗としてそのまま伝える。
      // ast-grep-ignore: unchecked-throwing-call
      events.push({ type: event.slice(7), data: JSON.parse(data.slice(6)) });
    }
  }
}

void test("SSEで画像・指定先・発見したPiの変化を通知し、Web許可を起動中に変更できる", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "photosync-events-"));
  const selection = new ReceiverSelection(directory);
  const errors: unknown[] = [];
  const inboxes = [new PhotoInbox(), new PhotoInbox()];
  const receivers = inboxes.map((inbox, index) => new PhotoReceiver({
    id: `r${index}`, host: "127.0.0.1", webOrigin: undefined, inbox, selection,
    identity: async () => ({ hostId: "host", host: "pc", cwd: "/work", project: "work", pid: index,
      terminal: "test", sessionId: `s${index}`, sessionName: null, model: null, herdr: null }),
    peers: () => [], onPhoto: () => {}, onError: (error) => errors.push(error),
  }));
  const logs: WireEvent[][] = [[], []];
  const readers: Promise<void>[] = [];
  t.after(async () => {
    await Promise.all(receivers.map((receiver) => receiver.close()));
    await Promise.all(readers);
    await rm(directory, { recursive: true });
  });
  await Promise.all(receivers.map((receiver) => receiver.start()));
  const urls = receivers.map((receiver) => `http://127.0.0.1:${receiver.port}`);
  const denied = await fetch(`${urls[0]}/v1/status`, { headers: { Origin: "http://127.0.0.1:8080" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  receivers[0].webOrigin = "http://127.0.0.1:8080";
  for (const [i, url] of urls.entries()) {
    const response = await fetch(`${url}/v1/events`);
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    if (i === 0) assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:8080");
    readers.push(collect(response, logs[i]));
  }
  await waitFor(() => logs.every((events) => events[0]?.type === "snapshot"));

  await selection.select("r1");
  await waitFor(() => logs.every((events) => events.some((e) => e.type === "status" && e.data.selection!.receiverId === "r1")));
  const image = await readFile(new URL("./fixtures/photo.png", import.meta.url));
  assert.equal((await fetch(`${urls[1]}/v1/photos/r1`, { method: "POST", headers: { "Content-Type": "image/png" }, body: image })).status, 200);
  await waitFor(() => logs[1].some((event) => event.type === "status" && event.data.pending === 1));
  inboxes[1].take();
  receivers[1].notifyStatus();
  await waitFor(() => logs[1].at(-1)?.data.pending === 0);

  receivers[0].notifyPeer({ type: "peer-up", peer: { id: "remote", url: "http://192.0.2.1:8000" } });
  await waitFor(() => logs[0].at(-1)?.type === "peer-up");
  receivers[0].notifyPeer({ type: "peer-down", id: "remote" });
  await waitFor(() => logs[0].at(-1)?.type === "peer-down");
  assert.equal(logs[0].at(-1)!.data.id, "remote");
  assert.deepEqual(errors, []);
});
