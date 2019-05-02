const StreamingServer = require('../rtsp-server');

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
