import { ClientServer } from './lib/ClientServer';
import { Mounts } from './lib/Mounts';
import { PublishServer } from './lib/PublishServer';
export interface RtspServerConfig {
    clientPort: number;
    rtpPortCount: number;
    rtpPortStart: number;
    serverPort: number;
}
export default class RtspServer {
    ClientServer: ClientServer;
    Mounts: Mounts;
    PublishServer: PublishServer;
    constructor(config: RtspServerConfig);
    start(): Promise<void>;
}
