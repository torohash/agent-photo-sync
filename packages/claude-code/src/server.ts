#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PhotoDiscovery } from "../../core/src/discovery.ts";
import {
  lanUrls,
  readHostIdentity,
  receiverPorts,
  stateDirectory,
} from "../../core/src/host.ts";
import { PhotoInbox } from "../../core/src/inbox.ts";
import type { SessionIdentity } from "../../core/src/protocol.ts";
import { PhotoReceiver } from "../../core/src/receiver.ts";
import { ReceiverSelection } from "../../core/src/selection.ts";

// 標準出力はMCPの通信に使うため、ログは標準エラー出力へ書く。
const report = (error: unknown) => console.error("[agent-photosync]", error);

const receiverId = randomUUID();
const inbox = new PhotoInbox();
const selection = new ReceiverSelection(stateDirectory());
// Claude Codeが子プロセスに渡す値。端末とPIDはClaude Code本体のものを表示する。
const claudePid = Number(process.env.CLAUDE_PID ?? process.ppid);

async function readIdentity(): Promise<SessionIdentity> {
  return {
    ...(await readHostIdentity(claudePid)),
    agent: "claude-code",
    cwd: process.cwd(),
    project: basename(process.cwd()),
    sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? "",
    sessionName: null,
    model: null,
  };
}

// 探索の通知はdiscovery.start()の後に届くため、その時点でreceiverは作成済み。
const discovery = new PhotoDiscovery(report, (change) =>
  receiver.notifyPeer(change),
);
const receiver = new PhotoReceiver({
  id: receiverId,
  host: "0.0.0.0",
  ports: receiverPorts(),
  webOrigin: process.env.PHOTOSYNC_WEB_ORIGIN,
  inbox,
  selection,
  identity: readIdentity,
  peers: () => discovery.peers(),
  onPhoto: () => {},
  onError: report,
});

const server = new McpServer(
  { name: "agent-photosync", version: "0.1.0" },
  {
    instructions:
      "ユーザーがスマホのAgent PhotoSyncアプリから写真を送ります。" +
      "「写真」「撮った画像」「スマホから送った」などに触れたら get_photos で受け取ってください。",
  },
);

server.registerTool(
  "get_photos",
  {
    title: "スマホの写真を受け取る",
    description:
      "Agent PhotoSyncアプリから受信し、まだ取得していない写真をすべて返す。返した写真は受信箱から消える。",
  },
  async () => {
    const images = inbox.take();
    receiver.notifyStatus();
    if (images.length === 0)
      return {
        content: [
          {
            type: "text",
            text: `未取得の写真はありません。アプリで Agent PhotoSync [${receiverId.slice(0, 8)}] を送信先に選んで撮影してください。`,
          },
        ],
      };
    return {
      content: [
        { type: "text", text: `スマホから受信した写真: ${images.length}枚` },
        ...images,
      ],
    };
  },
);

server.registerTool(
  "photosync_status",
  {
    title: "PhotoSyncの受信状態",
    description:
      "このセッションの受信先ID、未取得の写真の枚数、スマホからの接続先URLを返す。",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const status = await receiver.status();
    return {
      content: [
        {
          type: "text",
          text: [
            `Agent PhotoSync [${status.shortId}]`,
            `受信先ID: ${status.id}`,
            `PC: ${status.host} / 作業ディレクトリ: ${status.cwd}`,
            `PC側で指定: ${status.preferred ? "選択中" : "未選択"} / 未取得の写真: ${status.pending}枚`,
            `このPCのWeb確認用: http://127.0.0.1:${receiver.port}`,
            ...lanUrls(receiver.port).map((url) => `LAN接続先: ${url}`),
          ].join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "photosync_receive",
  {
    title: "このセッションを受信先に指定",
    description:
      "アプリの「PC側で指定」で送られる写真を、このClaude Codeセッションで受け取るように指定する。",
  },
  async () => {
    await selection.select(receiverId);
    return {
      content: [
        {
          type: "text",
          text: `Agent PhotoSync [${receiverId.slice(0, 8)}] をこのPCの受信先に指定しました。`,
        },
      ],
    };
  },
);

await receiver.start();
discovery.start(receiverId, receiver.port);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await receiver.close().catch(report);
  await discovery.close().catch(report);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.stdin.on("close", () => void shutdown());

await server.connect(new StdioServerTransport());
