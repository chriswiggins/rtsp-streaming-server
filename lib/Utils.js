const { URL } = require('url');


const mountRegex = /(\/\S+)(?:\/streamid=)(\d+)/;
const getMountInfo = (uri) => {
	let urlObj = new URL(uri);

	let mount = {
		path: urlObj.pathname,
		streamId: -1
	}

	if(urlObj.pathname.indexOf('streamid') > -1){
		let match = urlObj.pathname.match(mountRegex);
		mount.path = match[1];
		mount.streamId = parseInt(match[2]);
	}

	return mount;
}

module.exports = {
	getMountInfo
};