const Dgram = require('dgram');
const log = require('winston');

class RtpUdp {
	constructor(port, stream){
		this.port = port;
		this.stream = stream;
		this.type = (port % 2) ? 'rtcp' : 'rtp';

		this.server = Dgram.createSocket('udp4');
		this.server.on('message', (buf) => {
			for(let id in this.stream.clients){
				let client = this.stream.clients[id];
				
				//Differenciate rtp and rtcp so that the client object knows which port to send to
				client[`send_${this.type}`](buf);
			}
		});
	}

	async listen(){
		return new Promise((resolve, reject) => {
			let onError = (err) => {
				return reject(err);
			}

			this.server.on('error', onError);

			this.server.bind(this.port, () => {
				log.info(`Listener for Stream(${this.stream.id}) on path ${this.stream.mount.path} on port ${this.port} successful`);
				this.server.removeListener('error', onError);
				return resolve();
			});
		});
	}

	async close(){
		return new Promise((resolve, reject) => {
			this.server.close(() => {
				return resolve();
			});	
		});
	}
}

module.exports = RtpUdp;
