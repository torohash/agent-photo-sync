import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { PeerEndpoint } from "../packages/pi-extension/src/protocol.ts";

const directory = await mkdtemp(join(tmpdir(), "photosync-mdns-"));
const ids = [randomUUID(), randomUUID()];
const peers = ids.map((id) =>
  fork(
    new URL("./fixtures/discovery-peer.ts", import.meta.url),
    [id, directory],
    { execArgv: ["--import", "tsx"] },
  ),
);
try {
  const ready = await Promise.all(
    peers.map(
      async (peer) => (await once(peer, "message"))[0] as { port: number },
    ),
  );
  const url = `http://127.0.0.1:${ready[0].port}`;
  let discovered: PeerEndpoint[] = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    discovered = (await (
      await fetch(`${url}/v1/peers`)
    ).json()) as PeerEndpoint[];
    if (discovered.some((peer) => peer.id === ids[1])) break;
    await setTimeout(250);
  }
  const remote = discovered.find((peer) => peer.id === ids[1]);
  assert.ok(remote, "別プロセスのmDNSサービスを発見できること");
  const status = await (await fetch(`${remote.url}/v1/status`)).json();
  assert.equal(status.id, ids[1]);
  assert.equal(status.host, `pc-${ids[1]}`);
  console.log(
    `mDNSで別プロセスを発見し、公開されたLANアドレスから接続: ${remote.url}`,
  );
} finally {
  await Promise.all(
    peers.map(async (peer) => {
      peer.send("stop");
      await once(peer, "exit");
    }),
  );
  await rm(directory, { recursive: true });
}
