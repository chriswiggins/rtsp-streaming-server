import { parse } from 'basic-auth';
import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Mount } from './Mount';
import { Mounts } from './Mounts';
import { getDebugger } from './utils';

const debug = getDebugger('PublishServer');

export interface PublishServerHooksConfig {
  authentication?: (username: string, password: string, req: RtspRequest, res: RtspResponse) => Promise<boolean>;
  checkMount?: (req: RtspRequest) => Promise<boolean>;
  mountNowEmpty?: (mount: Mount) => Promise<void>;
}

/**
 *
 */
export class PublishServer {
  hooks: PublishServerHooksConfig;
  mounts: Mounts;
  rtspPort: number;
  server: RtspServer;
  private activeSessions: Map<string, { mount: Mount; socket: Socket }>;

  authenticatedHeader?: string;

  /**
   *
   * @param rtspPort
   * @param mounts
   */
  constructor (rtspPort: number, mounts: Mounts, hooks?: PublishServerHooksConfig) {
    this.rtspPort = rtspPort;
    this.mounts = mounts;
    this.activeSessions = new Map();

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
    res.setHeader('OPTIONS', 'DESCRIBE SETUP ANNOUNCE RECORD');
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

        const allowed = await this.hooks.authentication(result.name, result.pass, req, res);
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

    req.on('end', async () => {
      // Hook to check if this mount should exist or be allowed to be published
      if (this.hooks.checkMount) {
        const allowed = await this.hooks.checkMount(req);
        if (!allowed) {
          debug('%s:%s path not allowed by hook', req.socket.remoteAddress, req.socket.remotePort, req.uri);
          res.statusCode = 403;
          return res.end();
        }
      }

      let mount = this.mounts.getMount(req.uri);

      // If the mount already exists, reject
      if (mount) {
        debug('%s:%s - Mount already existed, sending 503: %o', req.socket.remoteAddress, req.socket.remotePort, req.uri);
        res.statusCode = 503;
        return res.end();
      }

      mount = this.mounts.addMount(req.uri, sdpBody, this.hooks);
      
      // Set up connection monitoring
      req.socket.once('close', () => this.handlePublisherDisconnect(mount, req.socket));
      req.socket.once('error', () => this.handlePublisherDisconnect(mount, req.socket));
      
      // Store the session
      this.activeSessions.set(mount.id, { mount, socket: req.socket });

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

    const transport = req.headers.transport?.toLowerCase() || '';
    const isTcp = transport.indexOf('tcp') > -1;
    
    if (isTcp) {
      debug('Publisher using TCP transport: %s', transport);
      const interleavedMatch = /interleaved=(\d+)-(\d+)/.exec(transport);
      const rtpChannel = interleavedMatch ? parseInt(interleavedMatch[1], 10) : 0;
      const rtcpChannel = interleavedMatch ? parseInt(interleavedMatch[2], 10) : 1;
      
      let buffer = Buffer.alloc(0);
      
      // Set up TCP data handler
      req.socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        
        while (buffer.length >= 4) {
          if (buffer[0] !== 0x24) { // Not an interleaved packet
            // Find next potential packet start
            const nextDollar = buffer.indexOf(0x24, 1);
            if (nextDollar === -1) {
              buffer = Buffer.alloc(0);
            } else {
              buffer = buffer.slice(nextDollar);
            }
            continue;
          }

          const channel = buffer[1];
          const length = buffer.readUInt16BE(2);
          const totalLength = length + 4;

          if (buffer.length < totalLength) {
            // Wait for more data
            break;
          }

          const payload = buffer.slice(4, totalLength);
          buffer = buffer.slice(totalLength);
          
          debug('Received complete TCP packet on channel %d, length %d', channel, length);
          
          const stream = mount.streams[0]; // Assuming stream ID 0
          if (stream) {
            for (let id in stream.clients) {
              const client = stream.clients[id];
              if (client.transportType === 'tcp' && client.rtpTcp) {
                if (channel === rtpChannel) {
                  client.rtpTcp.sendInterleavedRtp(payload);
                } else if (channel === rtcpChannel) {
                  client.rtpTcp.sendInterleavedRtcp(payload);
                }
              }
            }
          }
        }
      });

      res.setHeader('Transport', `RTP/AVP/TCP;interleaved=${rtpChannel}-${rtcpChannel}`);
      const create = mount.createStream(req.uri);
      res.end();
    } else {
      debug('Publisher using UDP transport: %s', transport);
      const create = mount.createStream(req.uri);
      debug('Created UDP stream with ports RTP: %d, RTCP: %d', create.rtpStartPort, create.rtpStartPort + 1);
      res.setHeader('Transport', `${req.headers.transport};server_port=${create.rtpStartPort}-${create.rtpEndPort}`);
      res.end();
    }
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

  protected handlePublisherDisconnect(mount: Mount, socket: Socket) {
    debug('Publisher disconnected for mount %s', mount.path);
    
    // Clean up the mount
    const ports = mount.close();
    ports.forEach(port => {
      this.mounts.returnRtpPortToPool(port);
    });
    
    // Remove the mount from mounts map
    if (this.mounts.getMount(mount.path)) {
      debug('Removing mount %s from mounts map', mount.path);
      this.mounts.deleteMount(mount.path);
    }
    
    // Remove from active sessions and clean up socket
    for (const [sessionId, session] of Array.from(this.activeSessions.entries())) {
      if (session.socket === socket) {
        debug('Removing session %s', sessionId);
        this.activeSessions.delete(sessionId);
        
        try {
          if (!socket.destroyed) {
            socket.end();
            socket.destroy();
          }
        } catch (err) {
          debug('Error destroying publisher socket: %s', err.message);
        }
        break;
      }
    }
  }
}
