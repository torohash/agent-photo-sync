import { Bonjour, type Browser, type Service } from "bonjour-service";
import { SERVICE_TYPE, type PeerChange, type PeerEndpoint } from "./protocol.ts";

/** Piごとの受信口をmDNSで公開し、同じLANの受信口を収集する。 */
export class PhotoDiscovery {
  private readonly bonjour: Bonjour;
  private browser?: Browser;
  private service?: Service;
  private readonly endpoints = new Map<string, PeerEndpoint>();

  constructor(onError: (error: Error) => void, private readonly onChange: (change: PeerChange) => void) {
    this.bonjour = new Bonjour(undefined, onError);
  }

  start(id: string, port: number): void {
    this.service = this.bonjour.publish({
      name: `Pi PhotoSync ${id}`,
      type: SERVICE_TYPE,
      protocol: "tcp",
      port,
      txt: { id },
      disableIPv6: true,
    });
    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: "tcp" });
    this.browser.on("up", (service: Service) => {
      const peer = {
        id: String(service.txt.id),
        url: `http://${service.referer!.address}:${service.port}`,
      };
      this.endpoints.set(service.name, peer);
      this.onChange({ type: "peer-up", peer });
    });
    this.browser.on("down", (service: Service) => {
      this.endpoints.delete(service.name);
      this.onChange({ type: "peer-down", id: String(service.txt.id) });
    });
  }

  peers(): PeerEndpoint[] {
    return [...this.endpoints.values()];
  }

  async close(): Promise<void> {
    this.browser?.stop();
    if (this.service)
      await new Promise<void>((resolve) => this.service!.stop(resolve));
    await new Promise<void>((resolve) => this.bonjour.destroy(resolve));
    this.endpoints.clear();
  }
}
