import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Client } from './Client';
import { Mounts } from './Mounts';

/**
 *
 */
export class ClientServer {
  private mounts: Mounts;
  private rtspPort: number;
  private server: RtspServer;
  private clients: { [sessionId: string]: Client };

  /**
   *
   * @param rtspPort
   * @param mounts
   */
  constructor (rtspPort: number, mounts: Mounts) {
    this.rtspPort = rtspPort;
    this.mounts = mounts;

    this.clients = {};

    this.server = createServer((req: RtspRequest, res: RtspResponse) => {
      switch (req.method) {
        case 'DESCRIBE':
          return this.describeRequest(req, res);
        case 'OPTIONS':
          return this.optionsRequest(req, res);
        case 'SETUP':
          return this.setupRequest(req, res);
        case 'PLAY':
          return this.playRequest(req, res);
        default:
          console.log(req.method, req.url);
          res.statusCode = 501; // Not implemented
          return res.end();
      }
    });
  }

  async start (): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.rtspPort, () => {
        console.log('RTSP client server is running on port:', this.rtspPort);

        return resolve();
      });
    });
  }

  /**
   *
   * @param req
   * @param res
   */
  optionsRequest (req: RtspRequest, res: RtspResponse): void {
    // Update the client timeout if they provide a session
    if (req.headers.session) {
      const client = this.clients[req.headers.session];
      if (client) {
        client.keepalive();
      } else {
        res.statusCode = 454; // Session not found
        return res.end();
      }
    }

    res.setHeader('DESCRIBE SETUP PLAY STOP', 'OPTIONS');
    return res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  describeRequest (req: RtspRequest, res: RtspResponse): void {
    const mount = this.mounts.getMount(req.uri);

    if (!mount) {
      res.statusCode = 404;
      return res.end();
    }

    res.setHeader('Content-Type', 'application/sdp');
    res.setHeader('Content-Length', Buffer.byteLength(mount.sdp));

    res.write(mount.sdp);
    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async setupRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    // TCP not supported (yet ;-))
    if (req.headers.transport && req.headers.transport.toLowerCase().indexOf('tcp') > -1) {
      res.statusCode = 504;
      return res.end();
    }

    const client = new Client(this.mounts, req);

    try {
      await client.setup(req);
    } catch (e) {
      console.error('Error setting up client', e);
      res.statusCode = 500;
      return res.end();
    }

    this.clients[client.id] = client;

    res.setHeader('Transport', `${req.headers.transport};server_port=${client.rtpServerPort}-${client.rtcpServerPort}`);
    res.setHeader('Session', `${client.id};30`);
    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  playRequest (req: RtspRequest, res: RtspResponse): void {
    if (!req.headers.session || !this.clients[req.headers.session]) {
      res.statusCode = 454; // Session not valid
      return res.end();
    }

    const client = this.clients[req.headers.session];
    client.play();

    if (client.mount.range) {
      res.setHeader('Range', client.mount.range);
    }

    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  teardownRequest (req: RtspRequest, res: RtspResponse): void {
    if (!req.headers.session || !this.clients[req.headers.session]) {
      res.statusCode = 454;
      return res.end();
    }

    const client = this.clients[req.headers.session];
    client.close();

    res.end();
  }
}
