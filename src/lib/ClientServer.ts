import { parse } from 'basic-auth';
import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Client } from './Client';
import { ClientWrapper } from './ClientWrapper';
import { Mount } from './Mount';
import { Mounts } from './Mounts';
import { getDebugger } from './utils';

const debug = getDebugger('ClientServer');

export interface ClientServerHooksConfig {
  authentication?: (username: string, password: string) => Promise<boolean>;
  checkMount?: (req: RtspRequest) => Promise<boolean>;
  clientClose?: (mount: Mount) => Promise<void>;
}

/**
 *
 */
export class ClientServer {
  hooks: ClientServerHooksConfig;

  mounts: Mounts;
  rtspPort: number;
  server: RtspServer;
  clients: { [sessionId: string]: ClientWrapper };

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
  async optionsRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    // Update the client timeout if they provide a session
    if (req.headers.session && await this.checkAuthenticated(req, res)) {
      const client = this.clients[req.headers.session];
      if (client) {
        client.keepalive();
      } else {
        res.statusCode = 454; // Session not found
        return res.end();
      }
    }

    res.setHeader('OPTIONS', 'DESCRIBE SETUP PLAY STOP');
    return res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async describeRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    if (!await this.checkAuthenticated(req, res)) {
      return res.end();
    }

    // Hook to set up the mount with a server if required before the client hits it
    // It'll fall through to a 404 regardless
    if (this.hooks.checkMount) {
      const allowed = await this.hooks.checkMount(req);
      if (!allowed) {
        debug('%s:%s path not allowed by hook', req.socket.remoteAddress, req.socket.remotePort, req.uri);
        res.statusCode = 403;
        return res.end();
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
    if (!await this.checkAuthenticated(req, res)) {
      return res.end();
    }

    // TCP not supported (yet ;-))
    if (req.headers.transport && req.headers.transport.toLowerCase().indexOf('tcp') > -1) {
      debug('%s:%s - we dont support tcp, sending 504: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 504;
      return res.end();
    }

    let clientWrapper: ClientWrapper;

    if (!req.headers.session) {
      clientWrapper = new ClientWrapper(this, req);
      this.clients[clientWrapper.id] = clientWrapper;
    } else if (this.clients[req.headers.session]) {
      clientWrapper = this.clients[req.headers.session];
    } else {
      return; // This theoretically never reaches, its just to fix TS checks
    }

    res.setHeader('Session', `${clientWrapper.id};timeout=30`);
    const client = clientWrapper.addClient(req);

    try {
      await client.setup(req);
    } catch (e) {
      console.error('Error setting up client', e);
      res.statusCode = 500;
      return res.end();
    }

    res.setHeader('Transport', `${req.headers.transport};server_port=${client.rtpServerPort}-${client.rtcpServerPort}`);

    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async playRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    if (!await this.checkAuthenticated(req, res)) {
      return res.end();
    }

    if (!req.headers.session || !this.clients[req.headers.session]) {
      debug('%s:%s - session not valid, sending 454: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 454; // Session not valid
      return res.end();
    }

    debug('%s calling play', req.headers.session);
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
  async teardownRequest (req: RtspRequest, res: RtspResponse): Promise<void> {
    if (!await this.checkAuthenticated(req, res)) {
      return res.end();
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
   * @param clientId
   */
  async clientGone (clientId: string): Promise<void> {
    if (this.hooks.clientClose) {
      await this.hooks.clientClose(this.clients[clientId].mount);
    }

    debug('ClientWrapper %s gone', clientId);

    delete this.clients[clientId];
  }

  /**
   *
   * @param req
   * @param res
   */
  private async checkAuthenticated (req: RtspRequest, res: RtspResponse): Promise<boolean> {
    // Ask for authentication
    if (this.hooks.authentication) {
      if (!req.headers.authorization) {
        debug('%s:%s - No authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
        res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
        res.statusCode = 401;
        return false;
      } else {
        const result = parse(req.headers.authorization);
        if (!result) {
          debug('%s:%s - No authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return false;
        }

        const allowed = await this.hooks.authentication(result.name, result.pass);
        if (!allowed) {
          debug('%s:%s - No authentication information (hook returned false), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return false;
        }
      }
    }

    return true;
  }
}
