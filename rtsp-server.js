const Rtsp = require('rtsp-server');
const Winston = require('winston');
Winston.configure({
	transports: [
		new (Winston.transports.Console)({
			json: false, 
			colorize: true, 
			timestamp: true, 
			handleExceptions: false,
			level: 'debug', 
			prettyPrint: function (obj){
				return JSON.stringify(obj);
			}
		})
	]
});

const ServerClass = require('./lib/Server');
const ClientServerClass = require('./lib/ClientServer');
const MountsClass = require('./lib/Mounts');

class RtspServer {
	constructor(config){
		this.Mounts = new MountsClass({
			rtpPortStart: config.rtpPortStart,
			rtpPortCount: config.rtpPortCount
		});

		this.Server = new ServerClass({
			rtspPort: config.serverPort
		}, this.Mounts);

		this.ClientServer = new ClientServerClass({
			rtspPort: config.clientPort
		}, this.Mounts);
	}

	async start(){
		try {
			await this.Server.start();
			await this.ClientServer.start();
		} catch (e) {
			throw e;
		}
	}
}

module.exports = RtspServer;