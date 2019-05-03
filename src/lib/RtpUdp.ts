import { createSocket, Socket } from 'dgram';

import { RtspStream } from './Mount';
import { getDebugger } from './utils';

const debug = getDebugger('RtpUdp');

export class RtpUdp {
  port: number;
  stream: RtspStream;
  server: Socket;
  type: 'rtp' | 'rtcp';

  constructor (port: number, stream: RtspStream) {
    this.port = port;
    this.stream = stream;
    this.type = (port % 2) ? 'rtcp' : 'rtp';

    this.server = createSocket('udp4');
    this.server.on('message', (buf: Buffer) => {
      for (let id in this.stream.clients) {
        let client = this.stream.clients[id];

        // Differenciate rtp and rtcp so that the client object knows which port to send to
        if (this.type === 'rtcp') {
          client.sendRtcp(buf);
        } else {
          client.sendRtp(buf);
        }
      }
    });
  }

  async listen (): Promise<void> {
    return new Promise((resolve, reject) => {
      function onError (err: Error) {
        return reject(err);
      }

      this.server.on('error', onError);

      this.server.bind(this.port, () => {
        debug('Opened %s listener for stream %s on path %s', this.type.toUpperCase(), this.stream.id, this.stream.mount.path);
        this.server.removeListener('error', onError);
        return resolve();
      });
    });
  }

  async close () {
    return new Promise((resolve, reject) => {
      debug('Closing UDP listeners for stream %s', this.stream.id);
      this.server.close(() => {
        return resolve();
      });
    });
  }
}
