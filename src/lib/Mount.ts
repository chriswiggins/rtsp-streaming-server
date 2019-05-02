import { v4 as uuid } from 'uuid';

import { Mounts } from './Mounts';
import { RtpUdp } from './RtpUdp';
import { getMountInfo } from './utils';

export type RtspStream = {
  id: number; // Not a UUID, this is the streamId in the RTSP spec
  mount: Mount;
  clients: any; // TODO
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
    [streamId: string]: RtspStream
  };

  sdp: string;
  range?: string;

  constructor (mounts: Mounts, path: string, sdpBody: string) {
    this.id = uuid();
    this.mounts = mounts;
    this.path = path;
    this.streams = {};

    this.sdp = sdpBody;

    console.log(`Set up mount at ${path}`);
  }

  createStream (uri: string) {
    const info = getMountInfo(uri);

    const nextPort = this.mounts.getNextRtpPort();

    if (!nextPort) {
      throw new Error('No ports available to create the stream');
    }

    console.log(`Setting up stream (${info.streamId}) on path ${this.path}`);

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
      let stream = this.streams[id];
      if (stream) {
        stream.listenerRtp && stream.listenerRtp.close();
        stream.listenerRtcp && stream.listenerRtcp.close();
      }

      ports.push(stream.rtpStartPort);
    }

    return ports;
  }
}
