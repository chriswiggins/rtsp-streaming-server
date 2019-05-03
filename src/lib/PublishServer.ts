import { parse } from 'basic-auth';
import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Mounts } from './Mounts';
import { getDebugger } from './utils';

const debug = getDebugger('PublishServer');

export interface PublishServerHooksConfig {
  authentication?: (username: string, password: string) => Promise<boolean>;
}

/**
 *
 */
export class PublishServer {
  hooks: PublishServerHooksConfig;
  mounts: Mounts;
  rtspPort: number;
  server: RtspServer;

  authenticatedHeader?: string;

  /**
   *
   * @param rtspPort
   * @param mounts
   */
  constructor (rtspPort: number, mounts: Mounts, hooks?: PublishServerHooksConfig) {
    this.rtspPort = rtspPort;
    this.mounts = mounts;

    this.hooks = {
      ...hooks
    };

    this.server = createServer((req: RtspRequest, res: RtspResponse) => {
      switch (req.method) {
        case 'OPTIONS':
          return this.optionsRequest(req, res);
        case 'ANNOUNCE':
          return this.announceRequest(req, res);
        case 'SETUP':
          return this.setupRequest(req, res);
        case 'RECORD':
          return this.recordRequest(req, res);
        case 'TEARDOWN':
          return this.teardownRequest(req, res);
        default:
          console.error('Unknown PublishServer request', { method: req.method, url: req.url });
          res.statusCode = 501; // Not implemented
          return res.end();
      }
    });
  }

  /**
   *
   */
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
  optionsRequest (req: RtspRequest, res: RtspResponse) {
    debug('Options request from %s with headers %o', req.socket.remoteAddress, req.headers);
    res.setHeader('DESCRIBE SETUP ANNOUNCE RECORD', 'OPTIONS');
    return res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async announceRequest (req: RtspRequest, res: RtspResponse) {
    debug('%s:%s - Announce request with headers %o', req.socket.remoteAddress, req.socket.remotePort, req.headers);
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
          debug('%s:%s - Invalid authentication information (required), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return res.end();
        }

        const allowed = await this.hooks.authentication(result.name, result.pass);
        if (!allowed) {
          debug('%s:%s - Invalid authentication information (Hook returned false), sending 401', req.socket.remoteAddress, req.socket.remotePort);
          res.setHeader('WWW-Authenticate', 'Basic realm="rtsp"');
          res.statusCode = 401;
          return res.end();
        }

        this.authenticatedHeader = req.headers.authorization;
      }
    }

    let sdpBody = '';
    req.on('data', (buf) => {
      sdpBody += buf.toString();
    });

    req.on('end', () => {
      let mount = this.mounts.getMount(req.uri);

      // If the mount already exists, reject
      if (mount) {
        debug('%s:%s - Mount already existed, sending 503: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
        res.statusCode = 503;
        return res.end();
      }

      mount = this.mounts.addMount(req.uri, sdpBody);
      res.setHeader('Session', `${mount.id};timeout=30`);
      debug('%s:%s - Set session to %s', req.socket.remoteAddress, req.socket.remotePort, mount.id);

      res.end();
    });
  }

  /**
   *
   * @param req
   * @param res
   */
  setupRequest (req: RtspRequest, res: RtspResponse) {
    // Authentication check
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    const mount = this.mounts.getMount(req.uri);
    if (!mount) {
      debug('%s:%s - No mount with path %s exists', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 404; // Unknown stream
      return res.end();
    }

    // TCP not supported (yet ;-))
    if (req.headers.transport && req.headers.transport.toLowerCase().indexOf('tcp') > -1) {
      debug('%s:%s - TCP not yet supported - sending 501', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 501; // Not Implemented
      return res.end();
    }

    const create = mount.createStream(req.uri);
    res.setHeader('Transport', `${req.headers.transport};server_port=${create.rtpStartPort}-${create.rtpEndPort}`);
    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async recordRequest (req: RtspRequest, res: RtspResponse) {
    // Authentication check
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    let mount = this.mounts.getMount(req.uri);

    if (!mount || mount.id !== req.headers.session) {
      debug('%s:%s - No mount with path %s exists, or the session was invalid', req.socket.remoteAddress, req.socket.remotePort, req.uri);
      res.statusCode = 454; // Session Not Found
      return res.end();
    }

    if (req.headers.range) {
      mount.range = req.headers.range;
    }

    try {
      await mount.setup();
    } catch (e) {
      console.error('Error setting up record request', e);
      res.statusCode = 500;
    }

    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  teardownRequest (req: RtspRequest, res: RtspResponse) {
    // Authentication check
    if (!this.checkAuthenticated(req, res)) {
      return;
    }

    debug('%s:%s - teardown %s', req.socket.remoteAddress, req.socket.remotePort, req.uri);
    this.mounts.deleteMount(req.uri);
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
        debug('%s:%s - auth header mismatch (401) %O', req.socket.remoteAddress, req.socket.remotePort, req.headers);
        res.statusCode = 401;
        res.end();
        return false;
      }
    }

    return true;
  }
}
