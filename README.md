# rtsp-streaming-server

Lightweight RTSP/RTP streaming media server written in Javascript.

First things first, credit to @revmischa for their work on the perl-based server. This is basically a blatant rip-off of that but ported to Javascript. See the original here [revmischa/rtsp-server](https://github.com/revmischa/rtsp-server)

Use this module to run an RTSP server in javascript. Common use case is for load balancing

## Running

`npm install --save rtsp-streaming-server`

Add the following to your script where you want to run the server:

```javascript

const StreamingServer = require('rtsp-streaming-server');

const server = new StreamingServer({
	serverPort: 5554,
	clientPort: 6554,
	rtpPortStart: 10000,
	rtpPortCount: 1000
});


const run = async () => {
	try {
		await server.start();
	} catch (e) {
		console.error(e);
	}
}

run();

```

Use an RTSP producer that supports ANNOUNCE (such as ffmpeg):

`ffmpeg -i <your_input>.mp4 -c:v copy -f rtsp rtsp://127.0.0.1:5554/stream1`

Consume that stream from your favourite RTSP Client:

`ffplay -i rtsp://127.0.0.1:5554/stream1`

`stream1` can be whatever you want, this server supports many producers and consumers on different mount points


## Options


* `serverPort`: port to listen to incoming RTSP/RTP streams from producers on
* `clientPort`: port to listen to incoming RTSP requests from clients on
* `rtpPortStart`: UDP port to start at for requests
* `rtpPortCount`: Number of UDP Ports to use for requests. This needs to be a multiple of 2 as pairs of ports are assigned for RTP sessions. If this is set too low and it runs out then no more streams will work


## Improvements coming soon (or PR's welcome!)

* Stability
* Authorisation
* RTP interleaved in RTSP (RTP over RTSP)
* Hooks for events when streams are published / consumed
