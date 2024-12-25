import { Socket } from 'net';
import { RtspStream } from './Mount';
import { getDebugger } from './utils';

const debug = getDebugger('RtpTcp');

export class RtpTcp {
  stream: RtspStream;
  clientSocket: Socket;
  interleaved: boolean;
  rtpChannel: number;
  rtcpChannel: number;
  private sendQueue: Buffer[];
  private sending: boolean;
  private closed: boolean;

  constructor(stream: RtspStream, clientSocket: Socket, rtpChannel: number = 0, rtcpChannel: number = 1) {
    this.stream = stream;
    this.clientSocket = clientSocket;
    this.interleaved = true;
    this.rtpChannel = rtpChannel;
    this.rtcpChannel = rtcpChannel;
    this.sendQueue = [];
    this.sending = false;
    this.closed = false;

    debug('Created RtpTcp handler with channels RTP: %d, RTCP: %d', rtpChannel, rtcpChannel);

    // Handle socket events
    this.clientSocket.on('drain', () => {
      this.processQueue();
    });

    this.clientSocket.on('error', (err) => {
      debug('Socket error: %s', err.message);
      this.close();
    });

    this.clientSocket.on('close', () => {
      debug('Socket closed');
      this.close();
    });
  }

  private async processQueue() {
    if (this.closed || this.sending || this.sendQueue.length === 0) return;
    this.sending = true;

    while (this.sendQueue.length > 0) {
      const packet = this.sendQueue[0];
      if (!this.clientSocket.write(packet)) {
        // Socket buffer is full, wait for drain
        break;
      }
      this.sendQueue.shift();
    }

    this.sending = false;
  }

  private queuePacket(packet: Buffer, isRtp: boolean) {
    if (this.closed) return;

    const header = Buffer.alloc(4);
    header.writeUInt8(0x24, 0); // $ character
    header.writeUInt8(isRtp ? this.rtpChannel : this.rtcpChannel, 1);
    header.writeUInt16BE(packet.length, 2);
    
    const fullPacket = Buffer.concat([header, packet]);
    this.sendQueue.push(fullPacket);
    this.processQueue();
  }

  sendInterleavedRtp(buffer: Buffer): void {
    if (this.closed || !this.interleaved || !this.clientSocket) return;
    debug('Queueing RTP packet over TCP, channel %d, length %d', this.rtpChannel, buffer.length);
    this.queuePacket(buffer, true);
  }

  sendInterleavedRtcp(buffer: Buffer): void {
    if (this.closed || !this.interleaved || !this.clientSocket) return;
    debug('Queueing RTCP packet over TCP, channel %d, length %d', this.rtcpChannel, buffer.length);
    this.queuePacket(buffer, false);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    
    debug('Closing RtpTcp handler');
    this.sendQueue = [];
    
    if (this.clientSocket) {
      try {
        this.clientSocket.end();
        this.clientSocket.destroy();
      } catch (err) {
        debug('Error closing socket: %s', err.message);
      }
    }
  }
}
