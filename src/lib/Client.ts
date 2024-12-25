import { createSocket, Socket } from 'dgram';
import { RtspRequest } from 'rtsp-server';
import { v4 as uuid } from 'uuid';
import { Socket as NetSocket } from 'net';
import { RtpTcp } from './RtpTcp';
import { RtpUdp } from './RtpUdp';

import { Mount, RtspStream } from './Mount';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('Client');

const clientPortRegex = /client_port=(\d+)-(\d+)/;

export class Client {
  open: boolean;
  id: string;
  mount: Mount;
  stream: RtspStream;

  transportType: 'udp' | 'tcp';
  rtpTcp?: RtpTcp;
  rtpUdp?: RtpUdp;

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
      throw new Error('No remote address or transport header missing');
    }

    this.remoteAddress = req.socket.remoteAddress.replace('::ffff:', '');

    // Handle client disconnection
    req.socket.on('close', () => {
      debug('Client socket closed: %s', this.id);
      this.close();
    });

    req.socket.on('error', (err) => {
      debug('Client socket error: %s, Error: %s', this.id, err.message);
      this.close();
    });

    // Check transport type
    if (req.headers.transport.toLowerCase().includes('tcp')) {
      this.transportType = 'tcp';
      this.setupTcpTransport(req);
    } else {
      this.transportType = 'udp';
      this.setupUdpTransport(req);
    }
  }

  protected setupTcpTransport(req: RtspRequest): void {
    const interleavedMatch = /interleaved=(\d+)-(\d+)/.exec(req.headers.transport);
    const rtpChannel = interleavedMatch ? parseInt(interleavedMatch[1], 10) : 0;
    const rtcpChannel = interleavedMatch ? parseInt(interleavedMatch[2], 10) : 1;

    this.rtpTcp = new RtpTcp(this.stream, req.socket as unknown as NetSocket, rtpChannel, rtcpChannel);

    // Register TCP client in the stream's tcpClients map
    if (!this.stream.tcpClients) {
      this.stream.tcpClients = {};
    }
    this.stream.tcpClients[this.id] = this.rtpTcp;
  }

  protected setupUdpTransport(req: RtspRequest): void {
    const portMatch = req.headers.transport.match(clientPortRegex);
    if (!portMatch) {
      throw new Error('Unable to find client ports in transport header');
    }

    this.remoteRtpPort = parseInt(portMatch[1], 10);
    this.remoteRtcpPort = parseInt(portMatch[2], 10);

    debug('Setting up UDP transport for client %s, remote ports RTP: %d, RTCP: %d', 
          this.id, this.remoteRtpPort, this.remoteRtcpPort);

    this.setupServerPorts();
    this.rtpServer = createSocket('udp4');
    this.rtcpServer = createSocket('udp4');

    // Initialize RtpUdp instance
    this.rtpUdp = new RtpUdp(this.rtpServerPort!, this.stream);

    // Set up UDP data handlers
    this.rtpServer.on('message', (msg: Buffer) => {
      debug('Received RTP packet from client %s, length: %d', this.id, msg.length);
      // Forward to stream's RTP handler
      if (this.stream.listenerRtp) {
        this.stream.listenerRtp.server.send(msg, this.stream.rtpStartPort);
      }
    });

    this.rtcpServer.on('message', (msg: Buffer) => {
      debug('Received RTCP packet from client %s, length: %d', this.id, msg.length);
      // Forward to stream's RTCP handler
      if (this.stream.listenerRtcp) {
        this.stream.listenerRtcp.server.send(msg, this.stream.rtpStartPort + 1);
      }
    });
  }

  /**
   *
   * @param req
   */
  async setup (req: RtspRequest): Promise<void> {
    if (this.transportType === 'tcp') {
      // TCP setup is already done in constructor
      return;
    }

    // UDP setup
    let portError = false;
    try {
      await this.listen();
    } catch (e) {
      if (e.errno && e.errno === 'EADDRINUSE') {
        console.warn(`Port error on ${e.port}, for stream ${this.stream.id} using another port`);
        portError = true;

        try {
          await this.rtpServer.close();
          await this.rtcpServer.close();
        } catch (e) {
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
    if (!this.open) return;
    this.open = false;

    // Remove from stream's clients
    if (this.stream && this.stream.clients) {
      delete this.stream.clients[this.id];
    }

    // Close TCP connection if exists
    if (this.rtpTcp) {
      this.rtpTcp.close();
      this.rtpTcp = undefined;
    }

    // Close UDP connection if exists
    if (this.rtpUdp) {
      await this.rtpUdp.close();
      this.rtpUdp = undefined;
    }

    if (this.transportType === 'tcp' && this.rtpTcp) {
      this.rtpTcp.close();
      // Remove TCP client from the stream's tcpClients map
      if (this.stream.tcpClients) {
        delete this.stream.tcpClients[this.id];
      }
    } else if (this.transportType === 'udp') {
      try {
        this.rtpServer.close();
        this.rtcpServer.close();
      } catch (e) {
        console.warn('Error closing UDP servers:', e);
      }
    }

    if (this.rtpServerPort) {
      this.mount.mounts.returnRtpPortToPool(this.rtpServerPort);
    }
  }

  /**
   *
   * @param buf
   */
  sendRtp (buffer: Buffer): void {
    if (!this.open) return;

    if (this.transportType === 'tcp' && this.rtpTcp) {
      this.rtpTcp.sendInterleavedRtp(buffer);
    } else if (this.transportType === 'udp') {
      debug('Sending RTP packet to client %s at %s:%d, length: %d', 
            this.id, this.remoteAddress, this.remoteRtpPort, buffer.length);
      this.rtpServer.send(buffer, this.remoteRtpPort, this.remoteAddress, (err) => {
        if (err) {
          debug('Error sending RTP packet to client %s: %s', this.id, err.message);
        }
      });
    }
  }

  /**
   *
   * @param buf
   */
  sendRtcp (buffer: Buffer): void {
    if (!this.open) return;

    if (this.transportType === 'tcp' && this.rtpTcp) {
      this.rtpTcp.sendInterleavedRtcp(buffer);
    } else if (this.transportType === 'udp') {
      debug('Sending RTCP packet to client %s at %s:%d, length: %d', 
            this.id, this.remoteAddress, this.remoteRtcpPort, buffer.length);
      this.rtcpServer.send(buffer, this.remoteRtcpPort, this.remoteAddress, (err) => {
        if (err) {
          debug('Error sending RTCP packet to client %s: %s', this.id, err.message);
        }
      });
    }
  }

  /**
   *
   */
  protected async listen (): Promise<void> {
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

  protected setupServerPorts (): void {
    const rtpServerPort = this.mount.mounts.getNextRtpPort();
    if (!rtpServerPort) {
      throw new Error('Unable to get next RTP Server Port');
    }

    this.rtpServerPort = rtpServerPort;
    this.rtcpServerPort = this.rtpServerPort + 1;
  }
}
