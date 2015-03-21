var db = require('./shared/lib/db');
var express = require('express');
var vhost = require('vhost');
var Log = require('log');
var services = require('./servers.json').services;


var ERROR_RESPONSE_CODE = 422;
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');


//Create server and router
var app = express();
var router = express.Router();



for (var i in services) {
	app.use(vhost(services[i].host, require(services[i].path + '/app').app));
}

//Start server
var port = process.env.PORT || 80;
app.listen( port, function() {
    logger.info( 'Promogram.me server listening on port %d in %s mode', port, app.settings.env );
});




