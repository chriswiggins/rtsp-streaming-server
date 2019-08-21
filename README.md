# rtsp-streaming-server

Lightweight RTSP/RTP streaming media server written in Javascript.

First things first, credit to @revmischa for their work on the perl-based server. This is basically a blatant rip-off of that but ported to Javascript (and now typescript!). See the original here [revmischa/rtsp-server](https://github.com/revmischa/rtsp-server)

Use this module to run an RTSP server in javascript. Common use case is for load balancing

## Running

`npm install --save rtsp-streaming-server`

Add the following to your script where you want to run the server:

```typescript

import RtspServer from 'rtsp-streaming-server'

const server = new RtspServer({
	serverPort: 5554,
	clientPort: 6554,
	rtpPortStart: 10000,
	rtpPortCount: 10000
});


async function run (): void {
	try {
		await server.start();
	} catch (e) {
		console.error(e);
	}
}

run();

```

If you're using javascript, you'll have to require the default export:
```javascript
const RtspServer = require('rtsp-streaming-server').default;
```

Use an RTSP producer that supports ANNOUNCE (such as ffmpeg):

`ffmpeg -i <your_input>.mp4 -c:v copy -f rtsp rtsp://127.0.0.1:5554/stream1`

Consume that stream from your favourite RTSP Client (note that you have to use the client port, not the publish port):

`ffplay -i rtsp://127.0.0.1:6554/stream1`

`stream1` can be whatever you want, this server supports many producers and consumers on different mount points


## Options


* `serverPort`: port to listen to incoming RTSP/RTP streams from producers on
* `clientPort`: port to listen to incoming RTSP requests from clients on
* `rtpPortStart`: UDP port to start at for requests
* `rtpPortCount`: Number of UDP Ports to use for requests. This needs to be a multiple of 2 as pairs of ports are assigned for RTP sessions. If this is set too low and it runs out then no more streams will work
* `publishServerHooks`: object of hooks for the publishing server
* `clientServerHooks`: object of hooks for the client server

## Hooks

Hooks are ways to allow / disallow connections to the server based on certain conditions. These need to be placed in the `publishServerHooks` or `clientServerHooks` objects

Authentication is to authenticate users connecting. A failed authentication sends a 401.

```
async function authentication (username: string, password: string): Promise<boolean> {
	if (username === 'test' && password === 'test') return true;
	
	return false;
}
```

Check mount is to allow / deny publishing or consuming depending on the uri of the stream being requested:

```
async function checkMount (req: RtspRequest): Promise<boolean | number> {
  const url = new URL(req.uri);
  if (url.pathname === '/test/1') {
    return true;
  }

	// If you want to reject the client side consuming with a specific code, return a number:
	if (somereason) {
		return 503; //Bad Gateway
	}

  return false;
}
```

Client Close is to do some tidy up when a client leaves (i.e you might want to signal to your publisher it can stop the stream). This is only valid in `clientServerHooks`

```
async function clientClose (mount: Mount): Promise<void> {
  console.log(`A client has disconnected from ${mount.path}`);
}
```

## Typescript information

If you're wanting to access any of the internal server components that reference the rtsp-server module, you'll have to add the types for this module `types/rtsp-server.d.ts` to your own project. These types are not in the server module itself.

## Improvements coming soon (or PR's welcome!)

* RTP interleaved in RTSP (RTP over RTSP)
* Check RTP is being received by the server and tear down the connection / mount if not
