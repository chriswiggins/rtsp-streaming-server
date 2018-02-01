const Rtsp = require('rtsp-server');
const log = require('winston');

class Server {
	constructor(config, mounts){
		this.config = config;
		this.mounts = mounts;

		this.server = Rtsp.createServer((req, res) => {
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
					log.error('Unknown server request', {method: req.method, url: req.url});
					res.statusCode = 501 // Not implemented 
					return res.end();
			}
		});
	}

	async start(){
		return new Promise((resolve, reject) => {
			this.server.listen(this.config.rtspPort, () => {
				log.info('RTSP server is running on port:', this.config.rtspPort);

				return resolve();
			});
		});
	}

	optionsRequest(req, res){
		res.setHeader('SETUP ANNOUNCE RECORD', 'OPTIONS');
		return res.end();
	}
	
	announceRequest(req, res){
		var sdpBody = '';
		req.on('data', (buf) => {
			sdpBody += buf.toString();
		});

		req.on('end', () => {
			let mount = this.mounts.getMount(req.uri);

			//If already exists, reject
			if(mount){
				res.statusCode = 503;
				return res.end();
			}

			this.mounts.addMount(req.uri, sdpBody);

			res.end();
		});
	}

	setupRequest(req, res){
		let mount = this.mounts.getMount(req.uri);

		//TCP not supported (yet ;-))
		if(req.headers.transport.toLowerCase().indexOf('tcp') > -1){
			res.statusCode = 504;
			res.end();
		}

		let create = mount.createStream(req.uri);

		res.setHeader('Transport', `${req.headers.transport};server_port=${create.rtpStartPort}-${create.rtpEndPort}`);
		res.end();
	}


	async recordRequest(req, res){
		let mount = this.mounts.getMount(req.uri);

		if(req.headers.range){
			mount.setRange(req.headers.range);
		}

		try {
			await mount.setup();
		} catch(e){
			log.error('Error setting up record request', e);
			res.statusCode = 500;
		}

		res.end();
	}


	teardownRequest(req, res){
		this.mounts.deleteMount(req.uri);
		res.end();
	}
}


module.exports = Server;