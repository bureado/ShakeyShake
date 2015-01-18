var http = require('http');
var azure = require('azure');
var WebSocket = require('ws');
var math = require('mathjs');

var config = require("./config.js");

var socket = new WebSocket(config.host);

// Azure config
var serviceBusService = azure.createServiceBusService(config.endpoint);
var AzureTopic = config.topic;

// Shake criteria config
var pixPerSec = 20;
var timeStep=1e3/pixPerSec;
var stationScalar = 3.20793 * Math.pow(10,5) * 9.8;
var MaxScale = 1.03; // scale
var AnalyzeSpan = 250; // packets
var lastNotification = new Date();
var maxNotification = 60; // prevent more than 1 notif/minute
var EventSpan = 2500; // ms

// Utility variables
var previousAvg = {}, recentAvg = {}, jumpTracker = {};

socket.on('message', function(msg) {
	var packet = JSON.parse(msg);

	if (!packet.data) {
		return;
	}

        var _decimate = packet.samprate / pixPerSec;
        var _i = 0;
        var _t = packet.starttime;
	var sta = makeChanKey(packet).substr(0,4);

        while (_i < packet.data.length) { // iterate thru all datapoints
            var _index = Math.round(_i += _decimate);
            if (_index < packet.data.length) {
		var curVal = Math.abs(packet.data[_index] / stationScalar); // this is the value we need
		
		if (!recentAvg[sta]){
			recentAvg[sta] = [];
		}
		recentAvg[sta].push(curVal);
		if(recentAvg[sta].length > AnalyzeSpan){
			currentAvg = math.mean(recentAvg[sta]);
			if(!previousAvg[sta]) {
				previousAvg[sta] = currentAvg;
			}
			console.log("Mean for " + AnalyzeSpan + " packets in sta " + sta + " is " + math.round(currentAvg, 6) + " previous was " + math.round(previousAvg[sta], 6));
			if (currentAvg > (previousAvg[sta]*MaxScale)) {
				console.log(new Date(_t).toString());
				console.log("That's a " + currentAvg/previousAvg[sta] + " increase! Threshold: " + MaxScale);
				jumpTracker[sta] = _t;
			} else {
				if(new Date() > (jumpTracker[sta] + EventSpan)) {
					console.log("Forgetting stale data for " + sta + " formerly: " + Object.keys(jumpTracker).length);
					delete jumpTracker[sta];
				}
			}
			previousAvg[sta] = currentAvg;
			delete recentAvg[sta];

//
			if (Object.keys(jumpTracker).length >= 2) { // we might have an event
				var dt = new Date();
				console.log("Event! " + dt.toString());
				if ((dt-lastNotification)/1e3>maxNotification) {
					var txt = "Event detected: " + dt.toString();
					var pk = { notification: txt, show: true };
					serviceBusService.sendTopicMessage(AzureTopic, { body: JSON.stringify(pk) }, function(error) {
					      if (error) { console.log(error); } else { console.log(pk); }
					});
					lastNotification = dt;
				} else {
					console.log("...but skipping notification due to wait period.");
				}
				jumpTracker = {};
			}
//

		}

                _t += timeStep;
            }
        }
});

// Shake utilities
makeTimeKey = function(t) {
	return parseInt(t / timeStep, 0) * timeStep;
};

makeChanKey = function(packet) {
        //remove the dashes that are the default for loc = null
        var loc = (!packet.loc || packet.loc == "--" || this.loc == "") ? "" : ("_" + packet.loc);
        return packet.sta.toLowerCase() + "_" + packet.chan.toLowerCase() + "_" + packet.net.toLowerCase() + loc;
};
