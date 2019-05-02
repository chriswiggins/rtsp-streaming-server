import { createSocket, Socket } from 'dgram';
import { RtspRequest } from 'rtsp-server';
import { v4 as uuid } from 'uuid';

import { Mount, RtspStream } from './Mount';
import { Mounts } from './Mounts';
import { getMountInfo, MountInfo } from './utils';

const clientPortRegex = /(?:client_port=)(\d*)-(\d*)/;

export class Client {
  id: string;
  info: MountInfo;
  keepaliveTimeout?: NodeJS.Timeout;
  mount: Mount;
  mounts: Mounts;
  stream: RtspStream;

  remoteAddress: string;
  remoteRtcpPort: number;
  remoteRtpPort: number;

  rtpServer: Socket;
  rtcpServer: Socket;
  rtpServerPort?: number;
  rtcpServerPort?: number;

  constructor (mounts: Mounts, req: RtspRequest) {
    this.mounts = mounts;

    this.id = uuid();
    this.info = getMountInfo(req.uri);

    const mount = this.mounts.mounts[this.info.path];
    if (!mount) {
      throw new Error('Mount does not exist');
    }

    this.mount = mount;
    this.stream = this.mount.streams[this.info.streamId];

    if (!req.socket.remoteAddress || !req.headers.transport) {
      throw new Error('No remote address found or transport header doesn\'t exist');
    }

    const portMatch: RegExpMatchArray | null = req.headers.transport.match(clientPortRegex);

    this.remoteAddress = req.socket.remoteAddress.replace('::ffff:', ''); // Strip IPv6 thing out

    if (!portMatch) {
      throw new Error('Unable to find client ports in transport header');
    }

    this.remoteRtpPort = parseInt(portMatch[1], 10);
    this.remoteRtcpPort = parseInt(portMatch[2], 10);

    this.setupServerPorts();

    this.rtpServer = createSocket('udp4');
    this.rtcpServer = createSocket('udp4');

  }

  /**
   *
   */
  async listen (): Promise<void> {
    return new Promise((resolve, reject) => {
      function onError (err: Error) {
        return reject(err);
      }

      this.rtpServer.on('error', onError);

      this.rtpServer.bind(this.rtpServerPort, () => {
        console.log(`Listener for Stream (${this.stream.id}) on path ${this.stream.mount.path} on port ${this.rtpServerPort} successful`);
        this.rtpServer.removeListener('error', onError);

        this.rtcpServer.on('error', onError);
        this.rtcpServer.bind(this.rtcpServerPort, () => {
          this.rtcpServer.removeListener('error', onError);

          return resolve();
        });
      });
    });
  }

  /**
   *
   * @param req
   */
  async setup (req: RtspRequest): Promise<void> {
    let portError = false;

    try {
      await this.listen();
    } catch (e) {
      // One or two of the ports was in use, cycle them out and try another
      if (e.errno && e.errno === 'EADDRINUSE') {
        console.warn(`Port error on ${e.port}, for stream ${this.stream.id} using another port`);
        portError = true;

        try {
          await this.rtpServer.close();
          await this.rtcpServer.close();
        } catch (e) {
          // Ignore, dont care if couldnt close
          console.log(e);
        }

        if (this.rtpServerPort) {
          this.mounts.returnRtpPortToPool(this.rtpServerPort);
        }

        this.setupServerPorts();

      } else {
        throw e;
      }
    }

    if (portError) {
      return this.setup(req);
    }
  }

  /**
   *
   */
  play (): void {
    this.stream.clients[this.id] = this;
  }

  /**
   *
   */
  async close (): Promise<void> {
    delete this.stream.clients[this.id];

    return new Promise((resolve, reject) => {
      this.rtpServer.close(() => {
        this.rtcpServer.close(() => {

          if (this.rtpServerPort) {
            this.mounts.returnRtpPortToPool(this.rtpServerPort);
          }

          return resolve();
        });
      });
    });
  }

  /**
   *
   * @param buf
   */
  send_rtp (buf: Buffer) {
    this.rtpServer.send(buf, this.remoteRtpPort, this.remoteAddress);
  }

  /**
   *
   * @param buf
   */
  send_rtcp (buf: Buffer) {
    this.rtcpServer.send(buf, this.remoteRtcpPort, this.remoteAddress);
  }

  keepalive (): void {
    if (this.keepaliveTimeout) {
      clearTimeout(this.keepaliveTimeout);
    }

    this.keepaliveTimeout = setTimeout(async () => {
      console.log('Client timeout');
      try {
        await this.close();
      } catch (e) {
        // Ignore
      }
    }, 6e4); // 60 seconds
  }

  private setupServerPorts (): void {
    const rtpServerPort = this.mounts.getNextRtpPort();
    if (!rtpServerPort) {
      throw new Error('Unable to get next RTP Server Port');
    }

    this.rtpServerPort = rtpServerPort;
    this.rtcpServerPort = this.rtpServerPort + 1;
  }
}
