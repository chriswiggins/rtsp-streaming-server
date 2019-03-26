const Rtsp = require('rtsp-server');
const log = require('winston');
const Client = require('./Client');


class ClientServer {
	constructor(config, mounts){
		this.config = config;
		this.mounts = mounts;

		this.clients = {};

		this.server = Rtsp.createServer((req, res) => {
			switch (req.method) {
				case 'DESCRIBE':
					return this.describeRequest(req, res);
				case 'OPTIONS':
					return this.optionsRequest(req, res);
				case 'SETUP':
					return this.setupRequest(req, res);
				case 'PLAY':
					return this.playRequest(req, res);
				default:
					console.log(req.method, req.url);
					res.statusCode = 501; // Not implemented 
					return res.end();
			}
		});
	}

	async start(){
		return new Promise((resolve, reject) => {
			this.server.listen(this.config.rtspPort, () => {
				log.info('RTSP client server is running on port:', this.config.rtspPort);

				return resolve();
			});
		});
	}

	optionsRequest(req, res){
		if(req.socket.uuid){
			let client = this.clients[req.socket.uuid];
			client.keepalive();
		}

		res.setHeader('SETUP PLAY STOP', 'OPTIONS');
		return res.end();
	}

	describeRequest(req, res){
		let mount = this.mounts.getMount(req.uri);

		if(!mount){
			res.statusCode = 404;
			return res.end();
		}

		res.setHeader('Content-Type', 'application/sdp');
		res.setHeader('Content-Length', Buffer.byteLength(mount.sdp));
		
		res.write(mount.sdp);
		
		res.end();
	}

	async setupRequest(req, res){
		//TCP not supported (yet ;-))
		if(req.headers.transport.toLowerCase().indexOf('tcp') > -1){
			res.statusCode = 504;
			return res.end();
		}

		let client = new Client(this.mounts, req);

		try {
			await client.setup();
		}catch(e){
			log.error('Error setting up client', e);
			res.statusCode = 500;
			return res.end();
		}

		this.clients[client.id] = client;

		res.setHeader('Transport', `${req.headers.transport};server_port=${client.rtpStartPort}-${client.rtpEndPort}`);
		res.end();
	}


	async playRequest(req, res){
		let clientId = req.socket.uuid;
		if(!clientId){
			res.statusCode = 404;
			return res.end();
		}

		let client = this.clients[clientId];
		client.play();

		if(client.mount.range){
			res.setHeader('Range', client.mount.range);
		}

		res.end();
	}


	teardownRequest(req, res){
		let clientId = req.socket.uuid;
		if(!clientId){
			res.statusCode = 404;
			return res.end();
		}

		let client = this.clients[clientId];
		client.close();

		res.end();
	}
}


module.exports = ClientServer;
