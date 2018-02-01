const Dgram = require('dgram');
const log = require('winston');
const Utils = require('./Utils');
const Uuid = require('uuid/v4');

const clientPortRegex = /(?:client_port=)(\d*)-(\d*)/;

class Client {
	constructor(mounts, req){
		this.mounts = mounts;

		this.id = Uuid();

		this.info = Utils.getMountInfo(req.uri);

		this.mount = this.mounts.mounts[this.info.path];
		this.stream = this.mount.streams[this.info.streamId];

		let portMatch = req.headers.transport.match(clientPortRegex);

		this.remoteAddress = req.socket.remoteAddress.replace('::ffff:', ''); //Strip IPv6 thing out

		this.remoteStartPort = parseInt(portMatch[1]);
		this.remoteEndPort = parseInt(portMatch[2]);

		this.rtpStartPort = this.mounts.getNextRtpPort();
		this.rtpEndPort = this.rtpStartPort + 1;

		this.rtpServer = Dgram.createSocket('udp4');
		this.rtcpServer = Dgram.createSocket('udp4');

		req.socket.uuid = this.id;
		
	}

	async listen(){
		return new Promise((resolve, reject) => {
			let onError = (err) => {
				return reject(err);
			}

			this.rtpServer.on('error', onError);

			this.rtpServer.bind(this.rtpStartPort, () => {
				//log.info(`Listener for Stream(${this.stream.id}) on path ${this.stream.mount.path} on port ${this.port} successful`);
				this.rtpServer.removeListener('error', onError);

				this.rtcpServer.on('error', onError);
				this.rtcpServer.bind(this.rtpEndPort, () => {
					this.rtcpServer.removeListener('error', onError);

					return resolve();
				});
			});
		});
	}

	async setup(req){
		var portError = false;

		try {
			await this.listen();
		} catch(e) {
			//One or two of the ports was in use, cycle them out and try another
			if(e.errno && e.errno === 'EADDRINUSE'){
				console.warn(`Port error on ${e.port}, for stream ${stream.id} using another port`);
				portError = true;

				try{
					await this.rtpServer.close();
					await this.rtcpServer.close();
				} catch(e) {
					//Ignore, dont care if couldnt close
					console.log(e);
				}

				this.mounts.returnRtpPortToPool(this.rtpStartPort);

				this.rtpStartPort = this.mounts.getNextRtpPort();
				this.rtpEndPort = this.rtpStartPort + 1;
			}else{
				throw e;
			}
		}

		if(portError){
			return this.setup();
		}


	}

	play(){
		this.stream.clients[this.id] = this;
	}

	async close(){
		this.stream.clients[this.id] = null;
		delete this.stream.clients[this.id];

		return new Promise((resolve, reject) => {
			this.rtpServer.close(() => {
				this.rtcpServer.close(() => {

					this.mounts.returnRtpPortToPool(this.rtpStartPort);

					return resolve();
				});
			});	
		});
	}


	send_rtp(buf){
		this.rtpServer.send(buf, this.remoteStartPort, this.remoteAddress);
	}

	send_rtcp(buf){
		this.rtcpServer.send(buf, this.remoteEndPort, this.remoteAddress);
	}

	keepalive(){
		clearTimeout(this.keepaliveTimeout);
		this.keepaliveTimeout = setTimeout(async () => {
			console.log('Client timeout');
			try {
				await this.close();
			} catch(e){
				//Ignore
			}
		}, 30000);
	}
}

module.exports = Client;
