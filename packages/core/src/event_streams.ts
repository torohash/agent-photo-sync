import type { ServerResponse } from "node:http";
import type { PeerChange, PeerEndpoint, ReceiverStatus } from "./protocol.ts";

/** 接続中のアプリへ状態変化を送り、同じ状態の重複通知を抑える。 */
export class EventStreams {
  private readonly clients = new Map<ServerResponse, string>();

  get size(): number {
    return this.clients.size;
  }

  add(response: ServerResponse, receiver: ReceiverStatus, peers: PeerEndpoint[]): void {
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    response.on("close", () => this.clients.delete(response));
    this.clients.set(response, JSON.stringify(receiver));
    this.send(response, "snapshot", { receiver, peers });
  }

  status(receiver: ReceiverStatus): void {
    const serialized = JSON.stringify(receiver);
    for (const [response, previous] of this.clients) {
      if (serialized === previous) continue;
      this.clients.set(response, serialized);
      this.send(response, "status", receiver);
    }
  }

  peer(change: PeerChange): void {
    for (const response of this.clients.keys()) {
      this.send(response, change.type, change.type === "peer-up" ? change.peer : { id: change.id });
    }
  }

  close(): void {
    for (const response of this.clients.keys()) response.end();
    this.clients.clear();
  }

  private send(response: ServerResponse, event: string, data: unknown): void {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
