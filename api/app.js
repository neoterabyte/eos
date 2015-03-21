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
								errmsg = "Instagram API error: " + error;	    				
								logger.error(errmsg);
							} else if (response && response.statusCode != 200) {
								errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
								logger.error(errmsg);
							}else{
								var userdata = (JSON.parse(body)).data;
								if (userdata.length > 0){
									msg = "user name: " + userdata[0].username + " user id: " + userdata[0].id;
									//tempHTML += msg;
									logger.info(msg);							
								}else{
									logger.info("invalid user: " + data.user_name);
								}
							}

						});

					})
					.on("end", function(){
						res.end(responseHeaderHTML + responseContentHTML.replace("@message","Instagram accounts verified") + responseFooterHTML);
					});
			}
		});

	}else{
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/bulk_load_agents', function(req, res) {

	
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
                
				var stream = fs.createReadStream("/tmp/promogram/agent_accounts.txt");
				var csv = require("fast-csv");

				csv
					.fromStream(stream, {headers : true})
					.on("data", function(data){

						// Search for User
						var options = {
							url: "https://api.instagram.com/v1/users/search?q=" + data.user_name + "&count=1&access_token=" + user.access_token
						};

						request(options, function (error, response, body) {

							if (error){
								errmsg = "Instagram API error: " + error;
								logger.error(errmsg);
							} else if (response && response.statusCode != 200) {
								errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
								logger.error(errmsg);
							}else{
								var userdata = (JSON.parse(body)).data;
								if (userdata.length > 0){

									//logger.info("user name: " + userdata[0].username + " user id: " + userdata[0].id);	
									
									//User was found, now search for Media
									var options1 = {
										url: "https://api.instagram.com/v1/users/" + userdata[0].id + "/media/recent/?COUNT=20&access_token=" + user.access_token
									};

									request(options1, function (error1, response1, body1) {

										if (error1){
											errmsg = "Instagram API error: " + error1;
											logger.error(errmsg);
										} else if (response1 && response1.statusCode != 200) {
											errmsg = "Instagram API error: " + http.STATUS_CODES[response1.statusCode] + " (" + response1.statusCode + ")";		    				
											logger.error(errmsg);
										}else{

											var mediadata = (JSON.parse(body1)).data;
											if (mediadata.length > 0){

												logger.info("user name: " + userdata[0].username + " user id: " + userdata[0].id + " media count: " + mediadata.length);

											}else{

											}
										}
									});


									//User was found, now search for follows
									var options2 = {
										url: "https://api.instagram.com/v1/users/" + userdata[0].id + "/follows?access_token=" + user.access_token
									};

									request(options2, function (error2, response2, body2) {

										if (error2){
											errmsg = "Instagram API error: " + error2;		    				
											logger.error(errmsg);
										} else if (response2 && response2.statusCode != 200) {
											errmsg = "Instagram API error: " + http.STATUS_CODES[response2.statusCode] + " (" + response2.statusCode + ")";		    				
											logger.error(errmsg);
										}else{

											var followsdata = (JSON.parse(body2)).data;
											if (followsdata.length > 0){

												logger.info("user name: " + userdata[0].username + " user id: " + userdata[0].id + " media count: " + followsdata.length);


											}else{

											}
										}
									});

									//User was found, now search for followed-by
									var options3 = {
										url: "https://api.instagram.com/v1/users/" + userdata[0].id + "/followed-by?access_token=" + user.access_token
									};

									request(options3, function (error3, response3, body3) {

										if (error3){
											errmsg = "Instagram API error: " + error3;		    				
											logger.error(errmsg);
										} else if (response3 && response3.statusCode != 200) {
											errmsg = "Instagram API error: " + http.STATUS_CODES[response3.statusCode] + " (" + response3.statusCode + ")";		    				
											logger.error(errmsg);
										}else{

											var followedbydata = (JSON.parse(body3)).data;
											if (followedbydata.length > 0){

												logger.info("user name: " + userdata[0].username + " user id: " + userdata[0].id + " media count: " + followedbydata.length);


											}else{

											}
										}
									});


								}else{
									logger.info("invalid user: " + data.user_name);
								}
							}

						});

					})
					.on("end", function(){
						res.end(responseHeaderHTML + responseContentHTML.replace("@message","Instagram agents loaded") + responseFooterHTML);
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



