import RtspServer from '../src';

const server = new RtspServer({
  clientPort: 6554,
  rtpPortCount: 10000,
  rtpPortStart: 10000,
  serverPort: 5554
});

async function run (): Promise<void> {
  try {
    await server.start();
  } catch (e) {
    console.error(e);
  }
}

run();
