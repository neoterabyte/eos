var fs = require('fs');
var db = require('../shared/lib/db');
var params = require('../shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('../shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');
var paypal = require('paypal-rest-sdk');
var session = require('cookie-session');
var url = require('url');

// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');

// Create the Express application
var app = exports.app = express(); 

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();

//use sessions
app.set('trust proxy', 1); // trust first proxy 
app.use(session({secret: "Drac0Dom1ng0"}));

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

paypal.configure(params.paypal_sanbox_api);
updateActiveAgentTokens(Agents);


router.get('/api/oauth', function(req, res) {
	
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
		var instagram_redirect_uri = params.instagram_api.redirect_uri.replace("@user_name", user_name);


		request.post(
		    'https://api.instagram.com/oauth/access_token',
		    { form: { 
		    	client_id: params.instagram_api.client_id, 
				client_secret: params.instagram_api.client_secret, 
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



router.get('/api/register_agent', function(req, res) {

	
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

				instagram_redirect_uri = encodeURIComponent(params.instagram_api.redirect_uri.replace("@user_name", user_name));
				
				var oauthURI = 'https://api.instagram.com/oauth/authorize/?client_id=' + params.instagram_api.client_id + '&response_type=code&redirect_uri=' + instagram_redirect_uri + "&scope=likes+comments+relationships";		
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


router.get('/api/find_agent', function(req, res) {

	
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

router.get('/api/find_like_subscriber', function(req, res) {

	
	var where = req.query.where;

	var dataOk = true,
	invalidParam = '';
		
	if (!where) {
		dataOk = false;
		invalidParam = 'where';
	}


	if (dataOk){

		var query  = LikeSubscribers.where(JSON.parse(where));

		query.find(function (err, likesubscriber) {
			if(err){
				res.statusCode = params.error_response_code
				res.end("Error: " + err);				
			}else{

				if (likesubscriber == null){
					res.statusCode = params.error_response_code
					res.end("No record found: " + err);
				}else{
					res.end(JSON.stringify(likesubscriber));
				}
  			}
		});
	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/api/update_agent', function(req, res) {

	
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



router.get('/api/agent_inter_follow', function(req, res) {

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
						}
					}				
				}
			}
		}
	});
		

	res.end ('Inter-follow process initiated');
});


router.get('/api/like_engine', function(req, res) {

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

					var i; 
					for (i in subscriber) {

						//use random access_token
						var randomIndex = Math.floor((Math.random() * activeAgentTokens.length) + 1);

						var options1 = {
							url: "https://api.instagram.com/v1/users/" + subscriber[i].user_id + "/media/recent/?access_token=" + activeAgentTokens[randomIndex] + "&count=1"
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
				
								if(mediadata.length > 0){

									for (k = 0; k < activeAgentTokens.length; k++) { 

										console.log("Image: " + mediadata[0].id + ", Token " + activeAgentTokens[k]);

										request.post(
										    "https://api.instagram.com/v1/media/" + mediadata[0].id + "/likes",
										    { form: { 
										    	access_token: activeAgentTokens[k] 
											} },
										    function (error2, response2, body2) {									        
										    	if (error2){
										    		errmsg = "Instagram like error: " + error2;
										            logger.error(errmsg);
										    	} else if (response2 && response2.statusCode != 200) {
										    		errmsg = "Instagram like error: Invalid response: " + http.STATUS_CODES[response2.statusCode] + " (" + response2.statusCode + ")";
										    		logger.error(errmsg);
										        }else{
										        	var code = (JSON.parse(body2)).meta.code;
										        	if(code != "200"){
										        		errmsg = "Instagram like error: Invalid response: " + http.STATUS_CODES[response2.statusCode] + " (" + response2.statusCode + ")";
										    			logger.error(errmsg);
										        	}else{
										        		logger.info("like done");
										        	}
										        }
										    }
										);
										
									}
	
								}

							}
						});
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


router.get('/api/add_like_subscriber', function(req, res) {

	
	var user_name = req.query.user_name;	
	var email = req.query.email;
	var subscription_plan = req.query.subscription_plan;
	
	var dataOk = true,
	invalidParam = '';
		
	if (!user_name) {
		dataOk = false;
		invalidParam = 'user_name';
	}else if (!subscription_plan) {
		dataOk = false;
		invalidParam = 'subscription_plan';
	}

	if (!((subscription_plan == "FREE") || (subscription_plan == "BRONZE") || (subscription_plan == "SILVER") || (subscription_plan == "GOLD"))){
		dataOk = false;
		invalidParam = 'subscription_plan';
	}

	if (!email) {
		email = '';
	}

	if (dataOk){

		var options = {
			url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&access_token=" + params.default_api_access_token + "&count=1" 
		};

		request(options, function (error, response, body) {

			if (error){
				errmsg = "Instagram API error: " + error;
				logger.error(errmsg + ", like subscriber name: " + user_name);	

				res.statusCode = params.error_response_code;
				res.end ("error connection to Instagram");
							
			} else if (response && response.statusCode != 200) {
				errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
				logger.error(errmsg  + ", ike subscriber: " + user_name);

				res.statusCode = params.error_response_code;
				res.end ("error connection to Instagram");

			}else{

				var userdata = (JSON.parse(body)).data;
				if (userdata.length > 0){

					//save session data
		     		req.session.user_id = userdata[0].id;
		     		req.session.user_name = userdata[0].username;
		     		req.session.subscription_plan = subscription_plan;
		     		req.session.email = email;		


					if (subscription_plan == "FREE"){

						LikeSubscribers.findOne(
							{user_id: userdata[0].id},  
							function (err, likesubscriber) {

								if(err) {
									logger.error("Error search for Like Subscriber in Mongo:  " + err);
									
									res.statusCode = params.error_response_code;
									res.end ("error connection to promogram data");

								}else if (likesubscriber == null){


									logger.error("New User!");

									logger.error("User data " + userdata[0].username);
									logger.error("Subscription plan " + subscription_plan);

									addLikeSubscribers(userdata[0].id, userdata[0].username, subscription_plan, email, function (error){

										if(error){
											res.statusCode = params.error_response_code;
											res.end (error);
										}else{
											var reply = { "status": "success" };
											res.end (JSON.stringify(reply));
										}

									});
									
								}else{
									logger.info("User already subscribed to free service and cannot re-subscribe");
									
									res.statusCode = params.error_response_code;
									res.end (userdata[0].username + " is already subscribed to a " + likesubscriber.subscription_plan + " plan");
								}
						});

						
					}else {
						//Paypal payment

						var plan_id = params.paypal_billing_plan_BRONZE; //default to bronze
						var plan_price = params.subscription_price_BRONZE;
						
						if (subscription_plan == "SILVER"){
							plan_id = params.paypal_billing_plan_SILVER;
							plan_price = params.subscription_price_SILVER;
						}else if (subscription_plan == "GOLD"){
							plan_id = params.paypal_billing_plan_GOLD;
							plan_price = params.subscription_price_GOLD;
						}

						var subscription_date = new Date();
						subscription_date.setDate(subscription_date.getDate() + 1);

						// all this date formatting necessary because for some wierd reason paypal ISO date does not include the milliseconds part						
						var month = subscription_date.getUTCMonth() + 1;
						month = (month < 10)? "0" + month: month;

						var day = subscription_date.getUTCDate();
						day = (day < 10)? "0" + day: day;

						var hours = subscription_date.getUTCHours();
						hours = (hours < 10)? "0" + hours: hours;

						var mins = subscription_date.getUTCMinutes();
						mins = (mins < 10)? "0" + mins: mins;

						var secs = subscription_date.getUTCSeconds();
						secs = (secs < 10)? "0" + secs: secs;

						//2015-03-30T00:37:04Z
						var formatted_date = subscription_date.getUTCFullYear() + "-" + month + "-" + day + "T" + hours + ":" + mins + ":" + secs + "Z";
						
						var billingAgreementAttributes = {
						    "name": subscription_plan + " Subscription Agreement ($" + plan_price + "/month)",
						    "description": req.session.user_name + "'s " + subscription_plan + " promogram subscription ($" + plan_price + "/month)",
						    "start_date": formatted_date,
						    "plan": {
						        "id": plan_id
						    },
						    "payer": {
						        "payment_method": "paypal"
						    },
						    "shipping_address": {
						    	"line1": "N/A",
						        "line2": "N/A",
						        "city": "Hartford",
						        "state": "CT",
						        "postal_code": "06114",
						        "country_code": "US"
						    }
						};

						logger.info(JSON.stringify(billingAgreementAttributes));

						// Use billing plan to create agreement
		                paypal.billingAgreement.create(billingAgreementAttributes, function (error, billingAgreement) {
		                    if (error) {
		                        res.statusCode = params.error_response_code;
								res.end ("error creating billing agreement, please try again");

						    	errmsg = "Error creating paypal subscription agreement: " + error;
								logger.error(errmsg);
		                    } else {
		                        
		                        
		                        logger.info(JSON.stringify(billingAgreement));
		                        
		                        for (var index = 0; index < billingAgreement.links.length; index++) {
		                            if (billingAgreement.links[index].rel === 'approval_url') {
		                                var approval_url = billingAgreement.links[index].href;
		                                logger.info("For approving subscription via Paypal, first redirect user to");
		                                logger.info(approval_url);

		                                logger.info("Payment token is");
		                                logger.info(url.parse(approval_url, true).query.token);

		                                var reply = { "status": "success", "redirect_uri": approval_url };
										res.end (JSON.stringify(reply));

		                                // See billing_agreements/execute.js to see example for executing agreement 
		                                // after you have payment token
		                            }
		                        }
		                    }
		                });

















/*
						var amount = "0.00";

						if (subscription_plan == "BRONZE"){
							amount = params.subscription_price_BRONZE;
						}else if (subscription_plan == "SILVER"){
							amount = params.subscription_price_SILVER;
						}else if (subscription_plan == "GOLD"){
							amount = params.subscription_price_GOLD;
						}

						var payment = {
							  "intent": "sale",
							  "payer": {
							    "payment_method": "paypal"
							  },
							  "redirect_urls": {
							    "return_url": params.paypal_success_redirect_uri,
							    "cancel_url": params.paypal_cancel_redirect_uri,
							  },
							  "transactions": [{
							    "amount": {
							      "total": amount,
							      "currency": "USD"
							    },
							    "description": "Promogram Subscription Service"
							  }]
							};

						paypal.payment.create(payment, function (error, payment) {
							if (error) {

								res.statusCode = params.error_response_code;
								res.end ("oops an error occurred, please try again");

						    	errmsg = "Error creating paypal payment: " + error;
								logger.error(errmsg + ", like subscriber name: " + user_name);

						  	} else {

						  		//logger.info("Payment Created " + JSON.stringify(payment));

						    	if(payment.payer.payment_method === 'paypal') {
						     		
						    		//save session data
						     		req.session.payment_id = payment.id;
						     		
						     		var redirectUrl;
						     		for(var i=0; i < payment.links.length; i++) {
						        		var link = payment.links[i];
						        		if (link.method === 'REDIRECT') {
						          			redirectUrl = link.href;
						        		}
						      		}
						      		var reply = { "status": "success", "redirect_uri": redirectUrl };
									res.end (JSON.stringify(reply));
						    	}
						  	}
						});
						*/












					}
	
				}else{

					errmsg = "Like subscriber not found: name: " + user_name;	    				
					logger.error(errmsg);

					res.statusCode = params.error_response_code;
					res.end ("instagram user name does not exist");
				}
			}
		});

	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/api/cancel_like_subscriber', function(req, res) {

	
	var user_name = req.query.user_name;	
	var subscription_plan = req.query.subscription_plan;
	
	var dataOk = true,
	invalidParam = '';
		
	if (!user_name) {
		dataOk = false;
		invalidParam = 'user_name';
	}else if (!subscription_plan) {
		dataOk = false;
		invalidParam = 'subscription_plan';
	}

	if (!((subscription_plan == "FREE") || (subscription_plan == "BRONZE") || (subscription_plan == "SILVER") || (subscription_plan == "GOLD"))){
		dataOk = false;
		invalidParam = 'subscription_plan';
	}

	
	if (dataOk){

		var options = {
			url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&access_token=" + params.default_api_access_token + "&count=1" 
		};

		request(options, function (error, response, body) {

			if (error){
				errmsg = "Instagram API error: " + error;
				logger.error(errmsg + ", like subscriber name: " + user_name);	

				res.statusCode = params.error_response_code;
				res.end ("error connection to Instagram");
							
			} else if (response && response.statusCode != 200) {
				errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
				logger.error(errmsg  + ", ike subscriber: " + user_name);

				res.statusCode = params.error_response_code;
				res.end ("error connection to Instagram");

			}else{

				var userdata = (JSON.parse(body)).data;
				if (userdata.length > 0){										

					//no need to get any feedback from mongo write
					LikeSubscribers.update({ user_id: userdata[0].id }, { $set: { is_active: false }}).exec();

					var reply = { "status": "success" };
					res.end (JSON.stringify(reply));
					
				}else{

					errmsg = "Like subscriber not found: name: " + user_name;	    				
					logger.error(errmsg);

					res.statusCode = params.error_response_code;
					res.end ("instagram user name does not exist");
				}
			}
		});

	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});




router.get('/api/payment_success', function(req, res) {

	var paymentId = req.session.payment_id;
	var payerId = req.query.PayerID;
	
	var uid = req.session.user_id;
	var uname = req.session.user_name;
	var plan = req.session.subscription_plan;
	var mail = req.session.email;

	var details = { "payer_id": payerId };
  	
  	paypal.payment.execute(paymentId, details, function (error, payment) {
    	if (error) {
    		logger.error("Paypal payment not successful: " + error);
      		res.redirect("/home?status=error");
    	} else {

			addLikeSubscribers(uid, uname, plan, mail, function (error){

				if(error){
					logger.error("Add subscriber was not successul but paypal payment was successful: " + error);
      				res.redirect("/home?status=error");
				}else{
					logger.error("Paypal payment successful: ");
					res.redirect("/home?status=success");
				}

			});
    	}
  	});


  	req.session = null; //Destroy session

});

router.get('/api/payment_cancelled', function(req, res) {

	logger.error("Paypal payment cancelled by user");
	res.redirect("/home");

});


router.get('/api/create_billing_plan', function(req, res) {
	
	var subscription_plan = req.query.subscription_plan;
	
	var dataOk = true,
	invalidParam = '';
		
	if (!subscription_plan) {
		dataOk = false;
		invalidParam = 'subscription_plan';
	}

	if (!((subscription_plan == "FREE") || (subscription_plan == "BRONZE") || (subscription_plan == "SILVER") || (subscription_plan == "GOLD"))){
		dataOk = false;
		invalidParam = 'subscription_plan';
	}
	
	if (dataOk){
		
		var amount = "0.00";

		if (subscription_plan == "BRONZE"){
			amount = params.subscription_price_BRONZE;
		}else if (subscription_plan == "SILVER"){
			amount = params.subscription_price_SILVER;
		}else if (subscription_plan == "GOLD"){
			amount = params.subscription_price_GOLD;
		}

		var billingPlanAttributes = {
		    "description": "Promogram Billing Plans: " + subscription_plan,
		    "merchant_preferences": {
		        "auto_bill_amount": "yes",
		        "cancel_url": params.paypal_cancel_redirect_uri,
		        "initial_fail_amount_action": "continue",
		        "max_fail_attempts": "1",
		        "return_url": params.paypal_success_redirect_uri,
		        "setup_fee": {
		            "currency": "USD",
		            "value": "0"
		        }
		    },
		    "name": "Promogram Billing Plans: " + subscription_plan,
		    "payment_definitions": [
		        {
		            "amount": {
		                "currency": "USD",
		                "value": amount
		            },
		            "charge_models": [
		            ],
		            "cycles": "0",
		            "frequency": "MONTH",
		            "frequency_interval": "1",
		            "name": subscription_plan,
		            "type": "REGULAR"
		        }
		    ],
		    "type": "INFINITE"
		};

		paypal.billingPlan.create(billingPlanAttributes, function (error, billingPlan) {
		    if (error) {
		        errmsg = "Error while creating billing plan: " + error;	    				
				logger.error(errmsg);

				res.statusCode = params.error_response_code;
				res.end (errmsg);
		    } else {
		        errmsg = "Billing plan created, will attempt to activate it... ";	    				
				logger.info(errmsg);

				var billingPlanId = billingPlan.id;

				var billing_plan_update_attributes = [
				    {
				        "op": "replace",
				        "path": "/",
				        "value": {
				            "state": "ACTIVE"
				        }
				    }
				];

				paypal.billingPlan.get(billingPlanId, function (error, billingPlan) {
				    if (error) {
				        errmsg = "Error while creating billing plan: " + error;	    				
						logger.error(errmsg);

						res.statusCode = params.error_response_code;
						res.end (errmsg);
				    } else {
				        
				        paypal.billingPlan.update(billingPlanId, billing_plan_update_attributes, function (error, response) {
				            if (error) {
				                errmsg = "Error while creating billing plan: " + error;	    				
								logger.error(errmsg);

								res.statusCode = params.error_response_code;
								res.end (errmsg);
				            } else {
				                paypal.billingPlan.get(billingPlanId, function (error, billingPlan) {
				                    if (error) {
				                        errmsg = "Error while creating billing plan: " + error;	    				
										logger.error(errmsg);

										res.statusCode = params.error_response_code;
										res.end (errmsg);
				                    } else {

				                    	errmsg = "Billing plan created, and Activated ";	    				
										logger.info(errmsg);
				                        
				                        res.end (JSON.stringify(billingPlan));
				                    }
				                });
				            }
				        });
				    }
				});
		    }
		});

	}else{
		res.statusCode = params.error_response_code;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}

});

router.get('/home', function(req, res) {

	var status = req.query.status;

	fs.readFile('./www/index.html', 'utf8', function (err,data) {
		if (!err) {
			res.end(String(data).replace('@subscription_result',status));
		}else{
			logger.error("Error reading index.html from file" );

			res.statusCode = params.error_response_code;
			res.end ("oops an error occurred, please try again");
		}
	});

});


router.get('/api/html/*', function(req, res) {
	res.sendFile(process.cwd() + req.path);	
});

router.get('/www/*', function(req, res) {
	res.sendFile(process.cwd() + req.path);	
});

// Register all our routes with /
app.use('/', router);

//---------------------------
//  FUNCTIONS 
//---------------------------

function addLikeSubscribers(user_id, user_name, subscription_plan, email, callback){
	
	var options1 = {
		url: "https://api.instagram.com/v1/users/" + user_id + "/?access_token=" + params.default_api_access_token
	};

	request(options1, function (error1, response1, body1) {

		if (error1){
			errmsg = "Instagram API error: " + error1;
			logger.error(errmsg  + ", user name: " + user_name);

			callback("error connection to Instagram");

		} else if (response1 && response1.statusCode != 200) {
			errmsg = "Instagram API error: " + http.STATUS_CODES[response1.statusCode] + " (" + response1.statusCode + ")";		    				
			logger.error(errmsg +  ", user name: " + user_name);

			callback("error connection to Instagram");

		}else{

			var udata = (JSON.parse(body1)).data;
			var amount = "0.00";

			var endDate = new Date();
			if (subscription_plan == "BRONZE"){
				endDate.setDate(endDate.getDate() + 30);
				amount = params.subscription_price_BRONZE;
			}else if (subscription_plan == "SILVER"){
				endDate.setDate(endDate.getDate() + 30);
				amount = params.subscription_price_SILVER;
			}else if (subscription_plan == "GOLD"){
				endDate.setDate(endDate.getDate() + 30);
				amount = params.subscription_price_GOLD;
			}else{
				//assume trial
				subscription_plan = "FREE";
				endDate.setDate(endDate.getDate() + 1);
				amount = "0.00";
			}
			
			LikeSubscribers.findOneAndUpdate(
				{user_id: udata.id}, 
				{
					user_id: udata.id, 
					user_name: udata.username, 
					follows: udata.counts.follows,
					followed_by: udata.counts.followed_by,
					media_count: udata.counts.media,
					email: email,
					subscription_plan: subscription_plan,
					subscription_group: params.current_like_subscription_group,
					subscription_start: new Date(),
					subscription_end: endDate,
					subscription_price: amount,
					is_active: true
				},
				{upsert: true}, 
				function (err, likesubscriber) {

					if(err){
						logger.error("Error updating Like Subscribers in Mongo:  " + err);

						callback("internal error updating subscriber details");
					}else{
						callback(); //successs
					}
			});
		}
	});				
}

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
		url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&access_token=" + access_token + "&count=1"
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

				
				//user_id was found update other parameters
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



