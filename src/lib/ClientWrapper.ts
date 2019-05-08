import { RtspRequest } from 'rtsp-server';
import { v4 as uuid } from 'uuid';

import { Client } from './Client';
import { ClientServer } from './ClientServer';
import { Mount } from './Mount';
import { Mounts } from './Mounts';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('ClientWrapper');

export class ClientWrapper {
  id: string;
  mount: Mount;
  clientServer: ClientServer;

  clients: {
    [clientId: string]: Client;
  };

  keepaliveTimeout?: NodeJS.Timeout;

  constructor (clientServer: ClientServer, req: RtspRequest) {
    this.id = uuid();
    this.clientServer = clientServer;
    this.clients = {};
    debug('%s - constructed', this.id);

    const info = getMountInfo(req.uri);
    const mount = clientServer.mounts.mounts[info.path];
    if (!mount) {
      throw new Error('Mount does not exist');
    }

    this.mount = mount;
  }

  /**
   *
   * @param mounts
   * @param req
   */
  addClient (req: RtspRequest): Client {
    const client = new Client(this.mount, req);
    this.clients[client.id] = client;
    debug('%s new client %s', this.id, client.id);
    return client;
  }

  /**
   *
   */
  play (): void {
    for (let client in this.clients) {
      this.clients[client].play();
    }

    this.keepalive();
  }

  /**
   *
   */
  close (): void {
    if (this.keepaliveTimeout) {
      clearTimeout(this.keepaliveTimeout);
    }

    for (let client in this.clients) {
      this.clients[client].close();
    }

    this.clientServer.clientGone(this.id);
  }

  /**
   *
   */
  keepalive (): void {
    if (this.keepaliveTimeout) {
      clearTimeout(this.keepaliveTimeout);
    }

    this.keepaliveTimeout = setTimeout(async () => {
      debug('%s client timeout, closing connection', this.id);
      try {
        await this.close();
      } catch (e) {
        // Ignore
      }
    }, 3e4); // 30 seconds
  }

}
