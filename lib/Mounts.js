const Mount = require('./Mount');
const Utils = require('./Utils');

class Mounts {
	constructor(config){
		this.mounts = {};
		
		this.rtpPorts = []; //It is assumed that each start port has a correlating end port of start+1

		for(let i = config.rtpPortStart; i < config.rtpPortStart + config.rtpPortCount; i = i+2){
			this.rtpPorts.push(i);
		}


	}

	getMount(uri){
		let info = Utils.getMountInfo(uri);

		return this.mounts[info.path];
	}

	addMount(uri, sdp){
		let info = Utils.getMountInfo(uri);
		this.mounts[info.path] = new Mount(this, info.path, sdp);
	}

	getNextRtpPort(){
		return this.rtpPorts.shift();
	}

	returnRtpPortToPool(port){
		this.rtpPorts.push(port);
	}

	deleteMount(uri){
		let info = Utils.getMountInfo(uri);

		let mount = this.mounts[info.path];
		let portsFreed = mount.close();

		this.rtpPorts = this.rtpPorts.concat(portsFreed);
		this.mounts[info.path] = null;
		delete this.mounts[info.path];
	}
}


module.exports = Mounts;