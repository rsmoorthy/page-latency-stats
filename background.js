
function PageLatencyStats(params)
{
	// interval is set to 30 mins (*60secs * 1000ms)
    var _arr = {urls:["*://*.isha.in/*"], interval: 30*60*1000};
    if(!params)
        params = {};
    for(var p in _arr) {
        if(!(p in this))
            this[p] = _arr[p];
        if(p in params)
            this[p] = params[p];
    }
    
    this.init();
}

PageLatencyStats.prototype.init = function() {
    var that = this;

    if(!that.urls)
    	that.urls = ["*://*.isha.in/*"]

    // My IPs
    that.getLocalIPs(function(ips) {
    	if(ips && ips[0])
    		that.ip = ips[0]
    	console.log("IP Address: " + that.ip)
    });

    that.requests = {};

	chrome.webRequest.onBeforeRequest.addListener( function(dt) { that.onBeforeRequest(dt); }, {urls: that.urls}, []);
	chrome.webRequest.onBeforeSendHeaders.addListener( function(dt) { that.onBeforeSendHeaders(dt); }, {urls: that.urls}, ["requestHeaders"]);
	chrome.webRequest.onResponseStarted.addListener( function(dt) { that.onResponseStarted(dt); }, {urls: that.urls}, ["responseHeaders"]);
	chrome.webRequest.onCompleted.addListener( function(dt) { that.onCompleted(dt); }, {urls: that.urls}, ["responseHeaders"]);
}

PageLatencyStats.prototype.queue = function(values) {
    var that = this;

    chrome.storage.local.get('queue', function(data) {
    	if(!data.queue) 
    		data.queue = {}

    	var url = values.url

    	if(!data.queue[url])
    		data.queue[url] = {}

    	// If cached
    	if(values.cached) {
    		if(!data.queue[url].cached) data.queue[url].cached = 0
    		data.queue[url].cached += 1
    	}
    	else {
    		if(!data.queue[url].access) data.queue[url].access = []
    		data.queue[url].access.push({ts: values.ts, time: values.time, status: values.status, size: values.size})
    	}
    	chrome.storage.local.set(data)
    });
    that.send()
}

PageLatencyStats.prototype.send = function() 
{
    var that = this;

    chrome.storage.local.get('lastSentTS', function(data) {
    	var now = new Date().getTime();
    	if(!data.lastSentTS) {
    		data.lastSentTS = now;
    		chrome.storage.local.set(data)
    		return;
    	}
    	if(now - data.lastSentTS < that.interval)
    		return;

    	chrome.storage.local.get('queue', function(data) {
    		if(!data.queue) 
    			return;

    		if(Object.size(data.queue) == 0)
    			return

    		var xhr = new XMLHttpRequest();
    		xhr.open("POST", "http://noc.isha.in/api.php?a=pageLatencyStats")
    		xhr.send(JSON.stringify({stats: data.queue}))
    		console.log("Sent packet to noc.isha.in")

    		chrome.storage.local.set({queue: {}, lastSentTS: new Date().getTime()})
    	});
    });
}

PageLatencyStats.prototype.onBeforeRequest = function(details) {
	var that = this;
	// console.log("before request " + details.requestId + " " + details.url);
	that.requests[details.requestId] = {url: details.url, ts: details.timeStamp, method: details.method}
	// console.log(details);
}

PageLatencyStats.prototype.onBeforeSendHeaders = function(details) {
	var that = this;
	// console.log("before send headers " + details.requestId + " " + details.url);
	var hdrs = that.parseHeaders(details.requestHeaders)
	that.requests[details.requestId]["modified"] = hdrs["If-Modified-Since"]
}

PageLatencyStats.prototype.onResponseStarted = function(details) {
	var that = this;
	if(details.statusCode == 304) {
		var timediff = details.timeStamp - that.requests[details.requestId]["ts"]
		var hdrs = that.parseHeaders(details.responseHeaders)
		console.log(details.statusCode + ": " + details.url + ", Size: " + hdrs["Content-Length"] + ", TimeDiff:" + timediff)
		that.queue({url: details.url, cached: false, status: 304, size: null, time: timediff, ts: details.timeStamp })
		delete that.requests[details.requestId]
		return
	}
	// console.log("on response started " + details.requestId + " " + details.url);
	// console.log(details)
}

PageLatencyStats.prototype.onCompleted = function(details) {
	var that = this;
	if(!that.requests[details.requestId])
		return
	// console.log("on completed" + details.requestId + " " + details.url);
	var timediff = details.timeStamp - that.requests[details.requestId]["ts"]
	var hdrs = that.parseHeaders(details.responseHeaders)
	if(details.fromCache) {
		console.log("CACHED: " + details.url + ", Size: " + hdrs["Content-Length"] + ", TimeDiff:" + timediff)
		that.queue({url: details.url, cached: true, size: hdrs["Content-Length"], time: timediff, ts: details.timeStamp })
	}
	else {
		console.log(details.statusCode + ": " + details.url + ", Size: " + hdrs["Content-Length"] + ", TimeDiff:" + timediff)
		that.queue({url: details.url, cached: false, status: details.statusCode, size: hdrs["Content-Length"], time: timediff, ts: details.timeStamp })
	}
	delete that.requests[details.requestId]
}

PageLatencyStats.prototype.parseHeaders = function(headers) {
	var hdrs = {};
	for(var i in headers) {
		hdrs[headers[i]["name"]] = headers[i]["value"]
	}
	return hdrs;
}


PageLatencyStats.prototype.getLocalIPs = function(callback) {
    var ips = [];

    var RTCPeerConnection = window.RTCPeerConnection ||
        window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

    var pc = new RTCPeerConnection({
        // Don't specify any stun/turn servers, otherwise you will
        // also find your public IP addresses.
        iceServers: []
    });
    // Add a media line, this is needed to activate candidate gathering.
    pc.createDataChannel('');
    
    // onicecandidate is triggered whenever a candidate has been found.
    pc.onicecandidate = function(e) {
        if (!e.candidate) { // Candidate gathering completed.
            pc.close();
            callback(ips);
            return;
        }
        var ip = /^candidate:.+ (\S+) \d+ typ/.exec(e.candidate.candidate)[1];
        if (ips.indexOf(ip) == -1) // avoid duplicate entries (tcp/udp)
            ips.push(ip);
    };
    pc.createOffer(function(sdp) {
        pc.setLocalDescription(sdp);
    }, function onerror() {});
}

var plstats = new PageLatencyStats({urls: ["*://*.isha.in/*", "*://*.ereceipts.in/*", "*://ereceipts.in/*", "*://live.sacredwalks.org/*"]})

Object.size = function(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};
/*
// onBeforeRequest
chrome.webRequest.onBeforeRequest.addListener( 
	function(details) {
		console.log(details);
	},
    {urls: ["*://*.isha.in/*"]},
	["requestBody"]
);

// onBeforeSendHeaders
chrome.webRequest.onBeforeSendHeaders.addListener( 
	function(details) {
		console.log("before send headers");
		console.log(details);
	},
    {urls: ["*://*.isha.in/*"]},
	["requestHeaders"]
);

// onCompleted
chrome.webRequest.onCompleted.addListener( 
	function(details) {
		console.log("on completed");
		console.log(details);
	},
    {urls: ["*://*.isha.in/*"]},
	["responseHeaders"]
);
*/
