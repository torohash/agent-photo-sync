#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PhotoDiscovery } from "../../core/src/discovery.ts";
import {
  lanUrls,
  readHostIdentity,
  receiverPorts,
  stateDirectory,
} from "../../core/src/host.ts";
import { type ImageContent, PhotoInbox } from "../../core/src/inbox.ts";
import type { SessionIdentity } from "../../core/src/protocol.ts";
import { PhotoReceiver } from "../../core/src/receiver.ts";
import { ReceiverSelection } from "../../core/src/selection.ts";

// 標準出力はMCPの通信に使うため、ログは標準エラー出力へ書く。
const report = (error: unknown) => console.error("[agent-photosync]", error);

const receiverId = randomUUID();

/**
 * get_photosが1回で返す画像の上限（base64の合計文字数）。
 * Claude CodeはMCPの1メッセージが16MBを超えると接続を切るため、既定は8MB。
 */
const maxResponseBytes = Number(
  process.env.PHOTOSYNC_MAX_RESPONSE_BYTES ?? 8 * 1024 * 1024,
);

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
};

/**
 * 受信した画像をファイルにも保存する受信箱。接続が切れてサーバーが
 * 再起動しても写真が残り、エージェントがパスから読み直せる。
 */
class SavingInbox extends PhotoInbox {
  readonly directory = join(
    stateDirectory(),
    "photos",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${receiverId.slice(0, 8)}`,
  );
  private paths: string[] = [];
  private saved = 0;

  override add(bytes: Uint8Array, mimeType: string): void {
    super.add(bytes, mimeType);
    let path = "";
    try {
      mkdirSync(this.directory, { recursive: true });
      path = join(
        this.directory,
        `${String(++this.saved).padStart(3, "0")}.${extensions[mimeType] ?? "bin"}`,
      );
      writeFileSync(path, bytes);
    } catch (error) {
      report(error);
      path = "";
    }
    this.paths.push(path);
  }

  takeWithPaths(maxBytes: number): { images: ImageContent[]; paths: string[] } {
    const images = super.take(maxBytes);
    return { images, paths: this.paths.splice(0, images.length) };
  }

  override take(maxBytes = Infinity): ImageContent[] {
    return this.takeWithPaths(maxBytes).images;
  }
}

const inbox = new SavingInbox();
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
      "Agent PhotoSyncアプリから受信し、まだ取得していない写真を受信順に返す。" +
      "1回の応答サイズに上限があり、残りがある場合はその枚数を返すので、もう一度呼ぶ。" +
      "返した写真は受信箱から消えるが、ファイルとして保存したパスも返す。" +
      "pathsOnly=trueでは画像を返さず、未取得の写真をすべて受信箱から取り出して保存先のパスだけを返す。" +
      "画像を見る必要がなく、別の担当者へファイルとして渡す場合に使う。",
    // SDKはオブジェクトのスキーマだけをツール一覧に載せるため、項目の形で渡す。
    // この場合、引数を省略した呼び出しは入力エラーになる（Claude Codeは空のオブジェクトを送る）。
    inputSchema: {
      pathsOnly: z
        .boolean()
        .optional()
        .describe("trueなら画像を返さず、保存先のパスだけを返す"),
    },
  },
  async ({ pathsOnly }) => {
    const { images, paths } = inbox.takeWithPaths(
      pathsOnly ? Infinity : maxResponseBytes,
    );
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
    const remaining = inbox.pending.length;
    const saved = paths.filter(Boolean);
    const unsaved = paths.length - saved.length;
    const lines = [
      `スマホから受信した写真: ${images.length}枚`,
      ...(pathsOnly && unsaved > 0
        ? [`${unsaved}枚はファイルへの保存に失敗したため、パスがありません。`]
        : []),
      ...(remaining > 0
        ? [
            `未取得の写真が残り${remaining}枚あります。get_photos をもう一度呼んで受け取ってください。`,
          ]
        : []),
      ...(saved.length > 0
        ? ["保存先（受信順）:", ...saved.map((path) => `- ${path}`)]
        : []),
    ];
    return {
      content: [
        { type: "text", text: lines.join("\n") },
        ...(pathsOnly ? [] : images),
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
            `写真の保存先: ${inbox.directory}`,
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
