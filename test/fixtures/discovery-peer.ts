import { PhotoDiscovery } from "../../packages/pi-extension/src/discovery.ts";
import { PhotoInbox } from "../../packages/pi-extension/src/inbox.ts";
import { PhotoReceiver } from "../../packages/pi-extension/src/receiver.ts";
import { ReceiverSelection } from "../../packages/pi-extension/src/selection.ts";

const [id, directory] = process.argv.slice(2);
const discovery = new PhotoDiscovery((error) => {
  throw error;
}, (change) => receiver.notifyPeer(change));
const receiver = new PhotoReceiver({
  id,
  host: "0.0.0.0",
  webOrigin: undefined,
  inbox: new PhotoInbox(),
  selection: new ReceiverSelection(directory),
  identity: async () => ({
    hostId: id,
    host: `pc-${id}`,
    cwd: "/project",
    project: "project",
    pid: process.pid,
    terminal: "test",
    sessionId: id,
    sessionName: null,
    model: null,
    herdr: null,
  }),
  peers: () => discovery.peers(),
  onPhoto: () => {},
  onError: (error) => { throw error; },
});
await receiver.start();
discovery.start(id, receiver.port);
process.send!({ port: receiver.port });
process.on("message", async () => {
  await receiver.close();
  await discovery.close();
  process.exit(0);
});
