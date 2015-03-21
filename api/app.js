var fs = require('fs');
var db = require('../shared/lib/db');
var params = require('../shared/config/instaparams.json');
var express = require('express');
var Log = require('log');
var ERROR_RESPONSE_CODE = 422;
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'api:';
var request = require('request');
var http = require('http');
var apiUser="neoterabyte";

// Create the Express application
var app = exports.app = express(); 

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();

// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');

var responseHeaderHTML, responseFooterHTML, responseContentHTML, responseErrorHTML;

fs.readFile('./api/html/header.html', 'utf8', function (err,data) {
	if (!err) {
		responseHeaderHTML = data;
	}else{
		responseHeaderHTML = '';
	}
});

fs.readFile('./api/html/footer.html', 'utf8', function (err,data) {
	if (!err) {
		responseFooterHTML = data;
	}else{
		responseFooterHTML = '';
	}
});

fs.readFile('./api/html/content.html', 'utf8', function (err,data) {
	if (!err) {
		responseContentHTML = data;
	}else{
		responseContentHTML = '';
	}
});

fs.readFile('./api/html/error.html', 'utf8', function (err,data) {
	if (!err) {
		responseErrorHTML = data;
	}else{
		responseErrorHTML = '';
	}
});

router.get('/oauth', function(req, res) {
	
	var error = req.query.error;
		
	if (error) {
		errmsg = 'Authentication Error: ' + error + " Error reason: " + req.query.error_reason + ", " + req.query.error_description;
		res.end(responseHeaderHTML + responseErrorHTML.replace("@message",errmsg) + responseFooterHTML);
		logger.error(errmsg);
	}else {
		var temporaryCode = req.query.code; // use temporary code that instagram gives you to use to extract the token
		logger.info('Temporary instagram code obtained: ' + temporaryCode);

		//Get user id from redirected end point
		var user_id = req.query.user_id;
		//no need to encode URL because its an http post
		var instagram_redirect_uri = params.instagram_redirect_uri.replace("@uid", user_id);


		request.post(
		    'https://api.instagram.com/oauth/access_token',
		    { form: { 
		    	client_id: params.instagram_client_id, 
				client_secret: params.instagram_client_secret, 
				grant_type: "authorization_code", 
				redirect_uri: instagram_redirect_uri, 
				code: temporaryCode 
			} },
		    function (error, response, body) {
		        
		    	if (error){

		    		errmsg = "Instagram authentication Error: " + error;
		            res.end(responseHeaderHTML + responseErrorHTML.replace("@message",errmsg) + responseFooterHTML);
					logger.error(errmsg);

		    	} else if (response && response.statusCode != 200) {
		    		errmsg = "Instagram authentication Error: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
		    		res.end(responseHeaderHTML + responseErrorHTML.replace("@message",errmsg) + responseFooterHTML);
					logger.error(errmsg);
		        }else{
		        	
		        	var access_token = (JSON.parse(body)).access_token;
					
					//Todo: consider also updating Mongo DB with the same information. 
					//update cache with user's access token
					cache.hmset(CACHE_PREFIX + 'user:' + apiUser, 'access_token', access_token);  
					
		        	msg = "Congratulations, you have successfully registered for this service. You can now use Promogram.me";
		        	res.end(responseHeaderHTML + responseContentHTML.replace("@message",msg) + responseFooterHTML);
		        	logger.info("Token obtained: " + access_token + " for " + user_id);

		        }

		    }
		);
	}

});



router.get('/bulk_verify', function(req, res) {

	
	var filepath = req.query.filepath;

	var dataOk = true,
	invalidParam = '';
		
	if (!filepath) {
		dataOk = false;
		invalidParam = 'filepath';
	}


	if (dataOk){

		cache.hgetall(CACHE_PREFIX + 'user:' + apiUser, function (err, user) {


			if((err) || (user == null)){

				instagram_redirect_uri = encodeURIComponent(params.instagram_redirect_uri.replace("@uid", apiUser));
				
				var oauthURI = 'https://api.instagram.com/oauth/authorize/?client_id=' + params.instagram_client_id + '&response_type=code&redirect_uri=' + instagram_redirect_uri;		
				msg = 'You have to permit Promogram.me to access Instagram. Don\'t worry, you only have to do this once. Click <a href=\'@oauthURI\'>this link to do this</a>';
				msg = msg.replace("@oauthURI", oauthURI);

				res.end(responseHeaderHTML + responseContentHTML.replace("@message",msg) + responseFooterHTML);
					
			}else{
                /*
				tempHTML = "";
				var stream = fs.createReadStream("/tmp/promogram/agent_accounts.txt");
				var csv = require("fast-csv");

				csv
					.fromStream(stream, {headers : true})
					.on("data", function(data){
						var options = {
							url: "https://api.instagram.com/v1/users/search?q=" + data.user_name + "&count=1&access_token=" + user.access_token
						};

						request(options, function (error, response, body) {

							if (error){
								errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
								res.send(responseErrorHTML.replace("@message",errmsg));
								logger.error(errmsg);
							} else if (response && response.statusCode != 200) {
								errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
								res.send(responseErrorHTML.replace("@message",errmsg));
								logger.error(errmsg);
							}else{
								var userdata = (JSON.parse(body)).data;
								if (userdata.length > 0){
									msg = "user name: " + userdata[0].username + " user id: " + userdata[0].id;
									tempHTML += msg;
									logger.info(msg);							
								}else{
									logger.info("invalid user: " + data.user_name);
								}
							}

						});

					})
					.on("end", function(){
						logger.info("Temp HTML is: " + tempHTML);
						res.end(responseHeaderHTML + tempHTML + responseFooterHTML);
					});


*/
				var stream = fs.createReadStream("/tmp/promogram/agent_accounts.txt");
				var csv = require("fast-csv"); 
				csv
				 .fromStream(stream, {headers : true})
				 .on("data", function(data){
				     console.log(data);
				 })
				 .on("end", function(){
				     console.log("done");
				 });


			}
		});

	}else{
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/html/*', function(req, res) {
	res.sendFile(process.cwd() + '/api' + req.path);	
});


// Register all our routes with /
app.use('/', router);



