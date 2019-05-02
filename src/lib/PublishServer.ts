import { createServer, RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';

import { Mounts } from './Mounts';

/**
 *
 */
export class PublishServer {
  mounts: Mounts;
  rtspPort: number;
  server: RtspServer;

  /**
   *
   * @param rtspPort
   * @param mounts
   */
  constructor (rtspPort: number, mounts: Mounts) {
    this.rtspPort = rtspPort;
    this.mounts = mounts;

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
          console.error('Unknown server request', { method: req.method, url: req.url });
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
        console.log('RTSP server is running on port:', this.rtspPort);

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
    res.setHeader('DESCRIBE SETUP ANNOUNCE RECORD', 'OPTIONS');
    if (req.headers.session) {
      console.log(req.headers);
    }
    return res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  announceRequest (req: RtspRequest, res: RtspResponse) {
    let sdpBody = '';
    req.on('data', (buf) => {
      sdpBody += buf.toString();
    });

    req.on('end', () => {
      const mount = this.mounts.getMount(req.uri);

      // If the mount already exists, reject
      if (mount) {
        res.statusCode = 503;
        return res.end();
      }

      this.mounts.addMount(req.uri, sdpBody);

      res.end();
    });
  }

  /**
   *
   * @param req
   * @param res
   */
  setupRequest (req: RtspRequest, res: RtspResponse) {
    const mount = this.mounts.getMount(req.uri);
    // TCP not supported (yet ;-))
    if (req.headers.transport && req.headers.transport.toLowerCase().indexOf('tcp') > -1) {
      res.statusCode = 501; // Not Implemented
      return res.end();
    }

    if (!mount) {
      res.statusCode = 404; // Unknown stream
      return res.end();
    }

    const create = mount.createStream(req.uri);

    res.setHeader('Transport', `${req.headers.transport};server_port=${create.rtpStartPort}-${create.rtpEndPort}`);
    res.setHeader('Session', `${mount.id};30`);
    res.end();
  }

  /**
   *
   * @param req
   * @param res
   */
  async recordRequest (req: RtspRequest, res: RtspResponse) {
    let mount = this.mounts.getMount(req.uri);

    if (!mount || mount.id !== req.headers.session) {
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
    this.mounts.deleteMount(req.uri);
    res.end();
  }
}
