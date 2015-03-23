var fs = require('fs');
var db = require('../shared/lib/db');
var params = require('../shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('../shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');

// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');

// Create the Express application
var app = exports.app = express(); 

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();


router.get('/www/*', function(req, res) {
	res.sendFile(process.cwd() + req.path);	
});

// Register all our routes with /
app.use('/', router);
