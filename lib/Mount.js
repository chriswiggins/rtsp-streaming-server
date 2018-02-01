//const Sdp = require('sdp-transform');
const Utils = require('./Utils');
const RtpUdp = require('./RtpUdp');
const log = require('winston');

class Mount {
	constructor(mounts, path, sdpBody){
		this.mounts = mounts;
		this.path = path;
		this.streams = {};
		this.rtpListeners = [];

		this.sdp = sdpBody;

		log.info(`Set up mount at ${path}`);
	}

	createStream(uri){
		let info = Utils.getMountInfo(uri);

		let nextPort = this.mounts.getNextRtpPort();

		log.info(`Setting up stream (${info.streamId}) on path ${this.path}`);
		
		this.streams[info.streamId] = {
			id: info.streamId,
			mount: this,
			clients: {},
			rtpStartPort: nextPort, //RTP
			rtpEndPort: nextPort+1 //RTCP
		};

		return this.streams[info.streamId];

	}

	setRange(range){
		this.range = range;
	}

	async setup(){
		var portError = false;

		for(let id in this.streams){
			let stream = this.streams[id];

			stream.startListener = new RtpUdp(stream.rtpStartPort, stream); //RTP
			stream.endListener = new RtpUdp(stream.rtpEndPort, stream); //RTCP
			
			try {
				await stream.startListener.listen();
				await stream.endListener.listen();
			} catch(e) {
				//One or two of the ports was in use, cycle them out and try another
				if(e.errno && e.errno === 'EADDRINUSE'){
					console.warn(`Port error on ${e.port}, for stream ${stream.id} using another port`);
					portError = true;

					try{
						await stream.startListener.close();
						await stream.endListener.close();
					} catch(e) {
						//Ignore, dont care if couldnt close
						console.log(e);
					}

					this.mounts.returnRtpPortToPool(stream.rtpStartPort);

					stream.rtpStartPort = this.mounts.getNextRtpPort();
					stream.rtpEndPort = stream.rtpEndPort+1;
					break;
				}

				return e;
			}
		}

		if(portError){
			return this.setup();
		}
	}

	close(){
		var ports = [];
		for(let id in this.streams){
			let stream = this.streams[id];
			
			stream.startListener.close();
			stream.endListener.close();

			ports.push(stream.rtpStartPort);
		}

		return ports;
	}
}

 module.exports = Mount;