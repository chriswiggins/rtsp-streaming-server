
import { ClientServer, ClientServerHooksConfig } from './lib/ClientServer';
import { Mounts } from './lib/Mounts';
import { PublishServer, PublishServerHooksConfig } from './lib/PublishServer';

export interface RtspServerConfig {
  clientPort: number;
  rtpPortCount: number;
  rtpPortStart: number;
  serverPort: number;

  publishServerHooks?: PublishServerHooksConfig;
  clientServerHooks?: ClientServerHooksConfig;
}

export default class RtspServer {
  public ClientServer: ClientServer;
  public Mounts: Mounts;
  public PublishServer: PublishServer;

  constructor (config: RtspServerConfig) {
    this.Mounts = new Mounts({
      rtpPortCount: config.rtpPortCount,
      rtpPortStart: config.rtpPortStart
    });

    this.PublishServer = new PublishServer(config.serverPort, this.Mounts, config.publishServerHooks);

    this.ClientServer = new ClientServer(config.clientPort, this.Mounts, config.clientServerHooks);
  }

  async start (): Promise<void> {
    try {
      await this.PublishServer.start();
      await this.ClientServer.start();
    } catch (e) {
      throw e;
    }
  }
}
