import { createSocket, Socket } from 'dgram';
import { Socket as TcpSocket } from 'net';
import { RtspRequest } from 'rtsp-server';
import { v4 as uuid } from 'uuid';

import { Mount, RtspStream } from './Mount';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('Client');

const clientPortRegex = /(?:client_port=)(\d*)-(\d*)/;
const interleavedChannelRegex = /(?:interleaved=)(\d*)-(\d*)/;

export class Client {
  open: boolean;
  id: string;
  mount: Mount;
  stream: RtspStream;

  remoteAddress: string;
  remoteRtcpPort: number;
  remoteRtpPort: number;

  rtpServer: Socket;
  rtcpServer: Socket;
  rtpServerPort?: number;
  rtcpServerPort?: number;

  constructor (mount: Mount, req: RtspRequest) {
    this.open = true;

    this.id = uuid();
    const info = getMountInfo(req.uri);
    this.mount = mount;

    if (this.mount.path !== info.path) {
      throw new Error('Mount does not equal request provided');
    }

    this.stream = this.mount.streams[info.streamId];

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
          console.warn(e);
        }

        if (this.rtpServerPort) {
          this.mount.mounts.returnRtpPortToPool(this.rtpServerPort);
        }

        this.setupServerPorts();

      } else {
        throw e;
      }
    }

    if (portError) {
      return this.setup(req);
    }

    debug(
      '%s:%s Client set up for path %s, local ports (%s:%s) remote ports (%s:%s)',
      req.socket.remoteAddress,req.socket.remotePort,
      this.stream.mount.path,
      this.rtpServerPort,this.rtcpServerPort,
      this.remoteRtpPort,this.remoteRtcpPort
    );
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
    this.open = false;
    this.mount.clientLeave(this);

    return new Promise((resolve) => {
      // Sometimes closing can throw if the dgram has already gone away. Just ignore it.
      try { this.rtpServer.close(); } catch (e) { debug('Error closing rtpServer for client %o', e); }
      try { this.rtcpServer.close(); } catch (e) { debug('Error closing rtcpServer for client %o', e); }

      if (this.rtpServerPort) {
        this.mount.mounts.returnRtpPortToPool(this.rtpServerPort);
      }

      return resolve();
    });
  }

  /**
   *
   * @param buf
   */
  sendRtp (buf: Buffer) {
    if (this.open === true) {
      this.rtpServer.send(buf, this.remoteRtpPort, this.remoteAddress);
    }
  }

  /**
   *
   * @param buf
   */
  sendRtcp (buf: Buffer) {
    if (this.open === true) {
      this.rtcpServer.send(buf, this.remoteRtcpPort, this.remoteAddress);
    }
  }

  /**
   *
   */
  private async listen (): Promise<void> {
    return new Promise((resolve, reject) => {
      function onError (err: Error) {
        return reject(err);
      }

      this.rtpServer.on('error', onError);

      this.rtpServer.bind(this.rtpServerPort, () => {
        this.rtpServer.removeListener('error', onError);

        this.rtcpServer.on('error', onError);
        this.rtcpServer.bind(this.rtcpServerPort, () => {
          this.rtcpServer.removeListener('error', onError);

          return resolve();
        });
      });
    });
  }

  private setupServerPorts (): void {
    const rtpServerPort = this.mount.mounts.getNextRtpPort();
    if (!rtpServerPort) {
      throw new Error('Unable to get next RTP Server Port');
    }

    this.rtpServerPort = rtpServerPort;
    this.rtcpServerPort = this.rtpServerPort + 1;
  }
}

export class InterleavedTcpClient {
  id: string;
  stream: RtspStream;
  mount: Mount;
  socket: TcpSocket | undefined;
  rtpChannel: number;
  rtcpChannel: number;

  constructor(mount: Mount, req: RtspRequest) {
    this.id = uuid()
    const info = getMountInfo(req.uri);
    this.mount = mount;

    if (this.mount.path !== info.path) {
      throw new Error('Mount does not equal request provided');
    }

    this.stream = this.mount.streams[info.streamId];

    if (!req.socket.remoteAddress || !req.headers.transport) {
      throw new Error('No remote address found or transport header doesn\'t exist');
    }

    const channelMatch: RegExpMatchArray | null = req.headers.transport.match(interleavedChannelRegex);

    if (!channelMatch) {
      throw new Error('Unable to find client ports in transport header');
    }

    this.rtpChannel = parseInt(channelMatch[1], 10);
    this.rtcpChannel = parseInt(channelMatch[2], 10);    
  }

  /**
   *
   * @param req
   */
  async setup (req: RtspRequest): Promise<void> {
    this.socket = req.socket;
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
    this.socket = undefined;
    this.mount.clientLeave(this);
  }

  /**
   *
   * @param buf
   */
  sendRtp (buf: Buffer) {
    this.writeEncodedInterleavedRTPPacket(this.rtpChannel, buf);
  }

  /**
   *
   * @param buf
   */
  sendRtcp (buf: Buffer) {
    this.writeEncodedInterleavedRTPPacket(this.rtcpChannel, buf);
  }  

  private writeEncodedInterleavedRTPPacket(channel: number, rtpBuffer: Buffer) {
    if( this.socket && !this.socket.destroyed) {
      const interleavedHeader = Buffer.alloc(4);
      interleavedHeader[0] = 0x24; // Magic byte for interleaved data
      interleavedHeader[1] = channel; // Channel number
      interleavedHeader.writeUInt16BE(rtpBuffer.length, 2); // Length of RTP data
      this.socket.write( Buffer.concat( [ interleavedHeader, rtpBuffer ] ) )
    }
  }
}