import RtspServer, { Mount } from '../src';

const server = new RtspServer({
  rtpPortCount: 10000,
  rtpPortStart: 10000,

  clientPort: 6554,
  clientServerHooks: {
    authentication: authHook,
    checkMount,
    clientClose
  },

  publishServerHooks: {
    authentication: authHook,
    checkMount
  },
  serverPort: 5554
});

async function run (): Promise<void> {
  try {
    await server.start();
  } catch (e) {
    console.error(e);
  }
}

async function authHook (username: string, password: string): Promise<boolean> {
  if (username === 'test' && password === 'test') return true;

  return false;
}

async function checkMount (req: any): Promise<boolean> {
  const url = new URL(req.uri);
  if (url.pathname === '/test/1') {
    return true;
  }

  return false;
}

async function clientClose (mount: Mount): Promise<void> {
  console.log(mount.streams);
}

run();
