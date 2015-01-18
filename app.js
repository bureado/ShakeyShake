var http = require('http');
var azure = require('azure');
var WebSocket = require('ws');

var config = require("./config.js");

var socket = new WebSocket(config.host);

// Azure config
var serviceBusService = azure.createServiceBusService(config.endpoint);
var AzureTopic = config.topic;

// Shake criteria config
var pixPerSec = 20;
var timeStep=1e3/pixPerSec;
var stationScalar = 3.20793 * Math.pow(10,5) * 9.8;
var MaxScale = 1.15; // new high if n% more than previous max
var MaxStale = 30000; // n seconds stale time for a recorded max
var MaxPackets = 5; // n packets before declaring an event
var curMax = 0;
var msgMax = {};
var jumpcounter = 0;
var lastNotification = new Date();
var minWait = 60;

socket.on('message', function(channel, msg) {
	var packet = JSON.parse(msg);
	if (!packet.data) {
		return;
	}
        var _decimate = packet.samprate / pixPerSec;
        var _i = 0;
        var _t = packet.starttime;
	if (msgMax[makeChanKey(packet)]){ // not our first packet
		if (msgMax[makeChanKey(packet)].hasOwnProperty('value')) { // not our first max
			curMax = msgMax[makeChanKey(packet)].value;
		}
	} else {
		msgMax[makeChanKey(packet)] = {};
	}
        while (_i < packet.data.length) { // iterate thru all datapoints
            var _index = Math.round(_i += _decimate);
            if (_index < packet.data.length) {
		var curVal = Math.abs(packet.data[_index] / stationScalar); // this is the value we need
		if ( curVal > curMax * MaxScale ){ // if it jumps...
			msgMax[makeChanKey(packet)] = {value: curVal, timestamp: _t, reason: 'scale', previous: curMax}; // we have a new max!
		}
		if ( _t >= msgMax[makeChanKey(packet)].timestamp + MaxStale ) { // if it stinks...
			msgMax[makeChanKey(packet)] = {value: curVal, timestamp: _t, reason: 'stale', previous: curMax}; // we have a new max!
		}
                _t += timeStep;
            }
        }

	// Let's analyze what happened with stations in this packet
	var alljump = true;
	for (var key in msgMax) { // analyze all stations
		if (msgMax[key].hasOwnProperty('reason') && jumpcounter == 0) {
			alljump = alljump && ((msgMax[key].reason == 'scale') && msgMax[key].previous > 0);
		}
	}
	if (alljump) { // we might have an event
		++jumpcounter;
		if (jumpcounter >= MaxPackets) { // we have an event
			var dt = new Date();
			if ((dt-lastNotification)/1e3<60) {
				var txt = "Shake detected: " + dt.toString;
				var pk = { notification: txt, show: true };
				serviceBusService.sendTopicMessage(AzureTopic, { body: JSON.stringify(pk) }, function(error) {
				      if (error) { console.log(error); } else { console.log(pk); }
				});
				lastNotification = dt;
			} else {
				console.log("Skipping event due to wait period");
			}
			jumpcounter = 0;
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
