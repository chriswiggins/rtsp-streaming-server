import RtspServer from '../src';

const server = new RtspServer({
  rtpPortCount: 10000,
  rtpPortStart: 10000,

  clientPort: 6554,
  clientServerHooks: {
    authentication: authHook
  },

  publishServerHooks: {
    authentication: authHook
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

run();
