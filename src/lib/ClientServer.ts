import { parse } from 'basic-auth';
import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Client } from './Client';
import { Mounts } from './Mounts';
import { getDebugger } from './utils';

const debug = getDebugger('ClientServer');

export interface ClientServerHooksConfig {
  authentication?: (username: string, password: string) => Promise<boolean>;
}

/**
 *
 */
export class ClientServer {
  hooks: ClientServerHooksConfig;

  private mounts: Mounts;
  private rtspPort: number;
  private server: RtspServer;
  private clients: { [sessionId: string]: Client };

  private authenticatedHeader?: string;

  /**
   *
   * @param rtspPort
   * @param mounts
   */
  constructor (rtspPort: number, mounts: Mounts, hooks?: ClientServerHooksConfig) {
    this.rtspPort = rtspPort;
    this.mounts = mounts;

    this.clients = {};

    this.hooks = {
      ...hooks
    };

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
        case 'TEARDOWN':
          return this.teardownRequest(req, res);
        default:
          console.error('Unknown ClientServer request', { method: req.method, url: req.url });
          res.statusCode = 501; // Not implemented
          return res.end();
      }
    });
  }

  async start (): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.rtspPort, () => {
        debug('Now listening on %s', this.rtspPort);

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
    if (req.headers.session && this.checkAuthenticated(req, res)) {
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
  async describeRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    // Ask for authentication
    if (this.hooks.authentication) {
      if (!req.headers.authorization) {
        debug('%s:%s - No authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
        res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
        res.statusCode = 401;
        return res.end();
      } else {
        const result = parse(req.headers.authorization);
        if (!result) {
          debug('%s:%s - No authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return res.end();
        }

        const allowed = await this.hooks.authentication(result.name, result.pass);
        if (!allowed) {
          debug('%s:%s - No authentication information (hook returned false), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return res.end();
        }

        this.authenticatedHeader = req.headers.authorization;
      }
    }

    const mount = this.mounts.getMount(req.uri);

    if (!mount) {
      debug('%s:%s - Mount not found, sending 404: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
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
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    // TCP not supported (yet ;-))
    if (req.headers.transport && req.headers.transport.toLowerCase().indexOf('tcp') > -1) {
      debug('%s:%s - we dont support tcp, sending 504: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
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
    res.setHeader('Session', `${client.id};timeout=30`);
    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  playRequest (req: RtspRequest, res: RtspResponse): void {
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    if (!req.headers.session || !this.clients[req.headers.session]) {
      debug('%s:%s - session not valid, sending 454: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
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
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    if (!req.headers.session || !this.clients[req.headers.session]) {
      debug('%s:%s - session not valid, sending 454: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 454;
      return res.end();
    }

    debug('%s:%s tearing down client', req.socket.remoteAddress, req.socket.remotePort);
    const client = this.clients[req.headers.session];
    client.close();

    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  private checkAuthenticated (req: RtspRequest, res: RtspResponse): boolean {
    if (this.hooks.authentication && this.authenticatedHeader) {
      if (req.headers.authorization !== this.authenticatedHeader) {
        res.statusCode = 401;
        res.end();
        return false;
      }
    }

    return true;
  }
}
