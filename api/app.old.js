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

var responseHeaderHTML, responseFooterHTML, responseContentHTML, responseErrorHTML;

var activeAgentTokens;

// Retrieve leave context
db.getModel('agents', function(err, model) {
    if (err) {
        logger.error('Fatal error: ' + err + '. Cannot retrieve agents schema');
    } else {
        Agents = model;
    }   
});

// Retrieve leave context
db.getModel('like_subscribers', function(err, model) {
    if (err) {
        logger.error('Fatal error: ' + err + '. Cannot retrieve like_subscribers schema');
    } else {
        LikeSubscribers = model;
    }   
});


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

updateActiveAgentTokens(Agents);

router.get('/oauth', function(req, res) {
	
	var error = req.query.error;
		
	if (error) {
		errmsg = 'Authentication Error: ' + error + " Error reason: " + req.query.error_reason + ", " + req.query.error_description;
		res.end(responseHeaderHTML + responseErrorHTML.replace("@message",errmsg) + responseFooterHTML);
		logger.error(errmsg);
	}else {
		var temporaryCode = req.query.code; // use temporary code that instagram gives you to use to extract the token
		logger.info('Temporary instagram code obtained: ' + temporaryCode);

		//Get user name from redirected end point
		var user_name = req.query.user_name;
		//no need to encode URL because its an http post
		var instagram_redirect_uri = params.instagram_redirect_uri.replace("@user_name", user_name);


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
					//cache.hmset(params.cache_prefix + 'user:' + params.default_api_user, 'access_token', access_token);  
					
					//update agents in mongo
					Agents.findOneAndUpdate({user_name:user_name}, {user_name:user_name, access_token: access_token, is_active: true}, {upsert: true}, function (err, agent) {});
					updateAgentData(Agents, user_name, access_token);	
					updateActiveAgentTokens(Agents);	
		        	
		        	msg = "Congratulations, you have successfully registered for this service. You can now use Promogram.me";
		        	res.end(responseHeaderHTML + responseContentHTML.replace("@message",msg) + responseFooterHTML);
		        	logger.info("Token obtained: " + access_token + " for " + user_name);

		        }

		    }
		);
	}

});



router.get('/register_agent', function(req, res) {

	
	var user_name = req.query.user_name;

	var dataOk = true,
	invalidParam = '';
		
	if (!user_name) {
		dataOk = false;
		invalidParam = 'user_name';
	}


	if (dataOk){

		var query  = Agents.where({ user_name: user_name });

		query.findOne(function (err, agent) {


			if((err) || (agent == null)){

				instagram_redirect_uri = encodeURIComponent(params.instagram_redirect_uri.replace("@user_name", user_name));
				
				var oauthURI = 'https://api.instagram.com/oauth/authorize/?client_id=' + params.instagram_client_id + '&response_type=code&redirect_uri=' + instagram_redirect_uri + "&scope=likes+comments+relationships";		
				msg = 'You have to permit Promogram.me to access Instagram. Don\'t worry, you only have to do this once. Click <a href=\'@oauthURI\'>this link to do this</a>';
				msg = msg.replace("@oauthURI", oauthURI);

				res.end(responseHeaderHTML + responseContentHTML.replace("@message",msg) + responseFooterHTML);
					
			}else{
                
				updateAgentData(Agents, user_name, agent.access_token);	
				res.end(responseHeaderHTML + responseContentHTML.replace("@message","User: " + user_name + " successfully registered") + responseFooterHTML);			
			}
		});

	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/find_agent', function(req, res) {

	
	var where = req.query.where;

	var dataOk = true,
	invalidParam = '';
		
	if (!where) {
		dataOk = false;
		invalidParam = 'where';
	}


	if (dataOk){

		var query  = Agents.where(JSON.parse(where));

		query.find(function (err, agent) {
			if(err){
				res.statusCode = params.error_response_code
				res.end("Error: " + err);				
			}else{

				if (agent == null){
					res.statusCode = params.error_response_code
					res.end("No record found: " + err);
				}else{
					res.end(JSON.stringify(agent));
				}
  			}
		});
	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});

router.get('/update_agent', function(req, res) {

	
	var where = req.query.where;

	var dataOk = true,
	invalidParam = '';
		
	if (!where) {
		dataOk = false;
		invalidParam = 'where';
	}

	if (dataOk){

		var query  = Agents.where(JSON.parse(where));

		query.find(function (err, agent) {
			if(err){
				res.statusCode = params.error_response_code
				res.end("Error: " + err);				
			}else{

				if (agent == null){
					res.statusCode = params.error_response_code
					res.end("No record found: " + err);
				}else{
					for (i in agent) {
						updateAgentData(Agents, agent[i].user_name, agent[i].access_token);	
					}
					updateActiveAgentTokens(Agents);
					res.end("Update initiated for agents, check logs for details ");
				}
  			}
		});
	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});



router.get('/agent_inter_follow', function(req, res) {

	cache.keys("*" + params.cache_prefix + "agent:*", function (err, keys) {
		if(err){
			console.log("Error getting keys from follow queue  ->" + err);
		}else{
			
			//delete all follow keys
			for (k = 0; k < keys.length; k++) { 
				cache.del(keys[k]);
			}

			//get all agents
			var query  = Agents.where({});		
			query.find(function (err, agent) {
				if(err){
					logger.error("Error getting agents: " + error);		
				}else{

					if (agent == null){
						logger.error("Error getting agents: Result returned null");	
					}else{

						for (i in agent) {
							for (j in agent) {

								if (i != j){ //do not add self

									logger.info("User: " + agent[i].user_id + " is being followed by: " + agent[j].user_id);

									request.post(
									    "https://api.instagram.com/v1/users/" + agent[i].user_id + "/relationship",
									    { form: { 
									    	access_token: agent[j].access_token, 
											action: "follow" 
										} },
									    function (error, response, body) {									        
									    	if (error){
									    		errmsg = "Instagram follow error: " + error;
									            logger.error(errmsg);
									    	} else if (response && response.statusCode != 200) {
									    		errmsg = "Instagram follow error: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
									    		logger.error(errmsg);
									        }else{
									        	var code = (JSON.parse(body)).meta.code;
									        	if(code != "200"){
									        		errmsg = "Instagram follow error: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
									    			logger.error(errmsg);
									        	}else{
									        		logger.info("follow requested: status: " + (JSON.parse(body)).data.outgoing_status);
									        	}
									        }
									    }
									);
									//cache.lpush(params.cache_prefix + "agent:" + agent[i].access_token, agent[j].user_id);
								}
							}				
						}
					}
				}
			});
		}
	});

	res.end ('Inter-follow process initiated');
});


router.get('/like_engine', function(req, res) {

	var where = req.query.where;

	var dataOk = true,
	invalidParam = '';
		
	if (!where) {
		dataOk = false;
		invalidParam = 'where';
	}

	if (dataOk){

		//get all subscribers

		var query  = LikeSubscribers.where(JSON.parse(where));		
		query.find(function (err, subscriber) {
			if(err){
				logger.error("Error getting Like Subscribers: " + error);		
			}else{

				if (subscriber == null){
					logger.error("Error Like Subscribers: Result returned null");	
				}else{

					for (i in subscriber) {


					}
				}
			}
		});
		
		res.end ('like engine initiated');

	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}

	res.end ('like engine initiated');
});



router.get('/html/*', function(req, res) {
	res.sendFile(process.cwd() + '/api' + req.path);	
});


// Register all our routes with /
app.use('/', router);

//---------------------------
//  FUNCTIONS 
//---------------------------

function updateActiveAgentTokens(Agents) {

	var query  = Agents.where({is_active:true});
	query.find(function (err, agent) {
		if(err){
			logger.error("Error updating active agent tokens: " + err);				
		}else{

			if (agent == null){
				logger.error("Error updating active agent tokens: agent is null");	
			}else{
				var tokens = new Array();
				for (i in agent) {
					tokens[tokens.length] = agent[i].access_token; 
				}

				activeAgentTokens = tokens;
			}
		}
	});	
}
    
function updateAgentData(Agents, user_name, access_token) {
    
	// Search for User
	var options = {
		url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&count=1&access_token=" + access_token
	};

	request(options, function (error, response, body) {

		if (error){
			errmsg = "Instagram API error: " + error;
			logger.error(errmsg + ", Agent name: " + user_name);	
			
			// update model with last_error
			Agents.update({ user_name: user_name }, { $set: { last_error: errmsg }}).exec();	
		
		} else if (response && response.statusCode != 200) {
			errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
			logger.error(errmsg  + ", Agent name: " + user_name);

			// update model with last_error
			Agents.update({ user_name: user_name }, { $set: { last_error: errmsg }}).exec();	

		}else{
			var userdata = (JSON.parse(body)).data;

			if (userdata.length > 0){	
				
				
				// update model with user_id
				Agents.update({ user_name: user_name }, { $set: { user_id: userdata[0].id }}).exec();

				
				//user_id was update other parameters
				var options1 = {
					url: "https://api.instagram.com/v1/users/" + userdata[0].id + "/?access_token=" + access_token
				};

				request(options1, function (error1, response1, body1) {

					if (error1){
						errmsg = "Instagram API error: " + error1;
						logger.error(errmsg  + ", user name: " + userdata[0].username);

						// update model with last_error
						Agents.update({ user_name: user_name }, { $set: { last_error: errmsg }}).exec();

					} else if (response1 && response1.statusCode != 200) {
						errmsg = "Instagram API error: " + http.STATUS_CODES[response1.statusCode] + " (" + response1.statusCode + ")";		    				
						logger.error(errmsg +  ", user name: " + userdata[0].username);

						// update model with last_error
						Agents.update({ user_name: user_name }, { $set: { last_error: errmsg }}).exec();

					}else{

						var udata = (JSON.parse(body1)).data;

						// update model with media count
						Agents.update({ user_name: user_name }, { $set: { media_count: udata.counts.media, follows: udata.counts.follows, followed_by: udata.counts.followed_by }}).exec();

					}
				});

			}else{
				errmsg = "Agent not found: Agent name: " + user_name;	    				
				logger.error(errmsg);

				// update model with last_error
				Agents.update({ user_name: user_name }, { $set: { last_error: errmsg }}).exec();	
			}
		}

	});    
}


