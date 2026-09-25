import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { FSWatcher } from "node:fs";
import { EventStreams } from "./event_streams.ts";
import type {
  PeerChange,
  PeerEndpoint,
  ReceiverStatus,
  SessionIdentity,
} from "./protocol.ts";
import type { PhotoInbox } from "./inbox.ts";
import type { ReceiverSelection } from "./selection.ts";

export interface ReceiverOptions {
  id: string;
  host: string;
  webOrigin: string | undefined;
  inbox: PhotoInbox;
  selection: ReceiverSelection;
  identity: () => Promise<SessionIdentity>;
  peers: () => PeerEndpoint[];
  onPhoto: () => void;
  onError: (error: unknown) => void;
}

/** HTTPで受信した画像をエージェントへ渡す前の画像として保持する。 */
export class PhotoReceiver {
  private readonly server;
  private readonly events = new EventStreams();
  private selectionWatcher?: FSWatcher;
  webOrigin: string | undefined;
  port = 0;
  private readonly options: ReceiverOptions;

  constructor(options: ReceiverOptions) {
    this.options = options;
    this.webOrigin = options.webOrigin;
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (response.headersSent) response.destroy(error as Error);
        else this.json(response, 500, { error: String(error) });
      });
    });
  }

  async start(): Promise<void> {
    await this.options.selection.initialize();
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, this.options.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.port = (this.server.address() as AddressInfo).port;
    this.selectionWatcher = this.options.selection.watch(() => this.notifyStatus());
    this.selectionWatcher.on("error", this.options.onError);
  }

  async status(): Promise<ReceiverStatus> {
    const identity = await this.options.identity();
    const selection = await this.options.selection.snapshot();
    return {
      ...identity,
      id: this.options.id,
      shortId: this.options.id.slice(0, 8),
      preferred: selection.receiverId === this.options.id,
      selection,
      pending: this.options.inbox.pending.length,
    };
  }

  notifyStatus(): void {
    if (this.events.size === 0) return;
    void this.status().then((status) => this.events.status(status)).catch(this.options.onError);
  }

  notifyPeer(change: PeerChange): void {
    this.events.peer(change);
  }

  private peers(request: IncomingMessage): PeerEndpoint[] {
    return [
      { id: this.options.id, url: `http://${request.headers.host}` },
      ...this.options.peers().filter((peer) => peer.id !== this.options.id),
    ];
  }

  async close(): Promise<void> {
    this.selectionWatcher?.close();
    this.events.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (this.webOrigin)
      response.setHeader("Access-Control-Allow-Origin", this.webOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
    } else if (request.method === "GET" && request.url === "/v1/status") {
      this.json(response, 200, await this.status());
    } else if (request.method === "GET" && request.url === "/v1/peers") {
      this.json(response, 200, this.peers(request));
    } else if (request.method === "GET" && request.url === "/v1/events") {
      this.events.add(response, await this.status(), this.peers(request));
    } else if (
      request.method === "POST" &&
      request.url === `/v1/photos/${this.options.id}`
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      this.options.inbox.add(
        Buffer.concat(chunks),
        request.headers["content-type"]!,
      );
      this.options.onPhoto();
      this.notifyStatus();
      this.json(response, 200, {
        id: this.options.id,
        pending: this.options.inbox.pending.length,
      });
    } else {
      this.json(response, 404, { error: "この受信先は存在しません。" });
    }
  }
}
