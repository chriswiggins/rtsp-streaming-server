import { v4 as uuid } from 'uuid';

import { Client } from './Client';
import { Mounts } from './Mounts';
import { PublishServerHooksConfig } from './PublishServer';
import { RtpUdp } from './RtpUdp';
import { RtpTcp } from './RtpTcp';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('Mount');

export type RtspStream = {
  id: number; // Not a UUID, this is the streamId in the RTSP spec
  mount: Mount;
  clients: { [clientId: string]: Client };
  listenerRtp?: RtpUdp;
  listenerRtcp?: RtpUdp;
  rtpStartPort: number;
  rtpEndPort: number;
  tcpClients?: { [clientId: string]: RtpTcp };
};

export class Mount {
  id: string;
  mounts: Mounts;
  path: string;
  streams: {
    [streamId: number]: RtspStream // This is the RTSP streamId Number, not a UUID
  };

  sdp: string;
  range?: string;

  hooks?: PublishServerHooksConfig;

  constructor (mounts: Mounts, path: string, sdpBody: string, hooks?: PublishServerHooksConfig) {
    this.id = uuid();
    this.mounts = mounts;
    this.path = path;
    this.streams = {};

    this.hooks = hooks;

    this.sdp = sdpBody;

    debug('Set up mount at path %s', path);
  }

  createStream (uri: string): RtspStream {
    const info = getMountInfo(uri);

    if (this.streams[info.streamId]) {
      throw new Error('Stream already exists');
    }

    const rtpStartPort = this.mounts.getNextRtpPort();

    if (!rtpStartPort) {
      throw new Error('Unable to get RTP port');
    }

    debug('Creating new stream %d for mount %s with RTP port %d', info.streamId, this.path, rtpStartPort);

    const stream: RtspStream = {
      id: info.streamId,
      clients: {},
      tcpClients: {},
      mount: this,
      rtpStartPort,
      rtpEndPort: rtpStartPort + 1
    };

    debug('Setting up UDP listeners for stream %d', info.streamId);
    stream.listenerRtp = new RtpUdp(rtpStartPort, stream);
    stream.listenerRtcp = new RtpUdp(rtpStartPort + 1, stream);

    this.streams[info.streamId] = stream;

    // Start UDP listeners
    Promise.all([
      stream.listenerRtp.listen(),
      stream.listenerRtcp.listen()
    ]).then(() => {
      debug('UDP listeners ready for stream %d', info.streamId);
    }).catch(err => {
      debug('Error starting UDP listeners for stream %d: %s', info.streamId, err.message);
    });

    return stream;
  }

  async setup (): Promise<void> {
    let portError = false;

    for (let id in this.streams) {
      let stream = this.streams[id];

      // Only set up UDP listeners if we have UDP clients
      if (Object.values(stream.clients).some(client => client.transportType === 'udp')) {
        stream.listenerRtp = new RtpUdp(stream.rtpStartPort, stream);
        stream.listenerRtcp = new RtpUdp(stream.rtpStartPort + 1, stream);

        try {
          await stream.listenerRtp.listen();
          await stream.listenerRtcp.listen();
        } catch (e) {
          // One or two of the ports was in use, cycle them out and try another
          if (e.errno && e.errno === 'EADDRINUSE') {
            console.warn(`Port error on ${e.port}, for stream ${stream.id} using another port`);
            portError = true;

            try {
              await stream.listenerRtp.close();
              await stream.listenerRtcp.close();
            } catch (e) {
              // Ignore, dont care if couldnt close
              console.log(e);
            }

            this.mounts.returnRtpPortToPool(stream.rtpStartPort);
            const nextStartPort = this.mounts.getNextRtpPort();
            if (!nextStartPort) {
              throw new Error('Unable to get another start port');
            }

            stream.rtpStartPort = nextStartPort;
            stream.rtpEndPort = nextStartPort + 1;
          } else {
            throw e;
          }
        }
      }
    }

    if (portError) {
      return this.setup();
    }
  }

  close(): number[] {
    const ports: number[] = [];
    
    // Close all streams and collect their ports
    Object.values(this.streams).forEach(stream => {
      if (stream.listenerRtp) {
        ports.push(stream.listenerRtp.port);
        stream.listenerRtp.close();
      }
      if (stream.listenerRtcp) {
        ports.push(stream.listenerRtcp.port);
        stream.listenerRtcp.close();
      }
      
      // Close all client connections
      Object.values(stream.clients).forEach(client => {
        debug('Closing client %s due to mount cleanup', client.id);
        client.close();
      });
      
      // Clear clients map
      stream.clients = {};
      
      // Clear TCP clients map
      if (stream.tcpClients) {
        Object.values(stream.tcpClients).forEach(tcpClient => {
          tcpClient.close();
        });
        stream.tcpClients = {};
      }
    });
    
    this.streams = {};
    return ports;
  }

  clientLeave (client: Client) {
    delete this.streams[client.stream.id].clients[client.id];
    let empty: boolean = true;
    for (let stream in this.streams) {
      if (Object.keys(this.streams[stream].clients).length > 0) {
        empty = false;
      }
    }

    if (empty === true && this.hooks && this.hooks.mountNowEmpty) {
      this.hooks.mountNowEmpty(this);
    }
  }
}
