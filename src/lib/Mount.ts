import { v4 as uuid } from 'uuid';

import { Client } from './Client';
import { Mounts } from './Mounts';
import { PublishServerHooksConfig } from './PublishServer';
import { RtpUdp } from './RtpUdp';
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

  createStream (uri: string) {
    const info = getMountInfo(uri);

    const nextPort = this.mounts.getNextRtpPort();

    if (!nextPort) {
      throw new Error('No ports available to create the stream');
    }

    debug('Setting up stream %s on path %s', info.streamId, info.path);

    this.streams[info.streamId] = {
      clients: {},
      id: info.streamId,
      mount: this,
      rtpEndPort: nextPort + 1, // RTCP
      rtpStartPort: nextPort // RTP
    };

    return this.streams[info.streamId];

  }

  async setup (): Promise<void> {
    let portError = false;

    for (let id in this.streams) {
      let stream = this.streams[id];

      stream.listenerRtp = new RtpUdp(stream.rtpStartPort, stream);
      stream.listenerRtcp = new RtpUdp(stream.rtpEndPort, stream);

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
          stream.rtpEndPort = stream.rtpEndPort + 1;
          break;
        }

        return e;
      }
    }

    if (portError) {
      return this.setup();
    }
  }

  close () {
    let ports = [];

    for (let id in this.streams) {
      const stream = this.streams[id];
      if (stream) {
        for (let id in stream.clients) {
          const client = stream.clients[id];
          console.log('Closing Client', client.id);
          client.close();
        }

        stream.listenerRtp && stream.listenerRtp.close();
        stream.listenerRtcp && stream.listenerRtcp.close();
      }

      ports.push(stream.rtpStartPort);
    }

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
