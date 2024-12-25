import { parse } from 'basic-auth';
import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { ClientWrapper } from './ClientWrapper';
import { Mount } from './Mount';
import { Mounts } from './Mounts';
import { getDebugger } from './utils';

const debug = getDebugger('ClientServer');

export interface ClientServerHooksConfig {
  authentication?: (username: string, password: string, req: RtspRequest, res: RtspResponse) => Promise<boolean>;
  checkMount?: (req: RtspRequest) => Promise<boolean | number>;
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
      debug('%s:%s request: %s %s', req.socket.remoteAddress, req.socket.remotePort, req.method, req.uri);
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

    // Monitor stalled mounts
    const checkMounts = () => {
      Object.values(this.clients).forEach(client => {
        const mount = this.mounts.getMount(client.mount.path);
        if (!mount) {
          debug('Mount %s no longer exists, closing client %s', client.mount.path, client.id);
          client.close();
          delete this.clients[client.id];
        }
      });
    };
    setInterval(checkMounts, 1000);
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
      if (!allowed || typeof allowed === 'number') {
        debug('%s:%s path not allowed by hook - hook returned: %s', req.socket.remoteAddress, req.socket.remotePort, req.uri, allowed);
        if (typeof allowed === 'number') {
          res.statusCode = allowed;
        } else {
          res.statusCode = 403;
        }

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

    let clientWrapper: ClientWrapper;

    if (!req.headers.session) {
      try {
        clientWrapper = new ClientWrapper(this, req);
      } catch (e) {
        debug('%s:%s - Mount not found, sending 404: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
        res.statusCode = 404;
        return res.end();
      }
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

    const transport = req.headers.transport?.toLowerCase() || '';
    const isTcp = transport.indexOf('tcp') > -1;

    if (isTcp) {
      debug('Client using TCP transport: %s', transport);
      const interleavedMatch = /interleaved=(\d+)-(\d+)/.exec(transport);
      const rtpChannel = interleavedMatch ? parseInt(interleavedMatch[1], 10) : 0;
      const rtcpChannel = interleavedMatch ? parseInt(interleavedMatch[2], 10) : 1;

      // Set up TCP data handler for client responses
      req.socket.on('data', (data: Buffer) => {
        if (data[0] === 0x24) { // Check for $ character
          const channel = data[1];
          const length = data.readUInt16BE(2);
          debug('Received TCP response from client on channel %d, length %d', channel, length);
        }
      });

      res.setHeader('Transport', `RTP/AVP/TCP;interleaved=${rtpChannel}-${rtcpChannel}`);
    } else {
      res.setHeader('Transport', `${req.headers.transport};server_port=${client.rtpServerPort}-${client.rtcpServerPort}`);
    }

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
      debug('%s:%s - session not valid (%s), sending 454: %o', req.socket.remoteAddress, req.socket.remotePort, req.headers.session, req.uri);
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
      debug('%s:%s - session not valid (%s), sending 454: %o', req.socket.remoteAddress, req.socket.remotePort, req.headers.session, req.uri);
      res.statusCode = 454;
      return res.end();
    }

    debug('%s:%s tearing down client', req.socket.remoteAddress, req.socket.remotePort);
    const client = this.clients[req.headers.session];
    client.close();
    delete this.clients[req.headers.session];

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
        if (req.headers.session && this.clients[req.headers.session] && this.clients[req.headers.session].authorizationHeader !== req.headers.authorization) {
          debug('%s:%s - session header doesn\'t match the cached value, sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return false;
        }

        const result = parse(req.headers.authorization);
        if (!result) {
          debug('%s:%s - No authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return false;
        }

        const allowed = await this.hooks.authentication(result.name, result.pass, req, res);
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
