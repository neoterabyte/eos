var fs = require('fs');
var db = require('../shared/lib/db');
var params = require('../shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('../shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');
var url = require('url');
var bodyParser = require('body-parser');
var mailer = require('express-mailer');

// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');

// Create the Express application
var app = exports.app = express(); 
app.set('view engine', 'ejs');  
app.set('views', process.cwd() + '/www');

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();


app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));  
 
mailer.extend(app, {
	from: "Promogram Orders <" + params.order_email + ">",
  	host: 'smtp.gmail.com', // hostname 
  	secureConnection: true, // use SSL 
  	port: 465, // port for secure SMTP 
  	transportMethod: 'SMTP', // default is SMTP. Accepts anything that nodemailer accepts 
  	auth: {
    	user: params.order_email,
    	pass: params.order_password
  	}
});


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
					//cache.hmset(params.cache_prefix + 'user:' + params.default_instagram_api_user, 'access_token', access_token);  
					
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

router.get('/api/update_agent_plan', function(req, res) {

	
	var user_name = req.query.user_name;
	var plan = req.query.plan;
	var overwrite = req.query.overwrite;

	var dataOk = true,
	invalidParam = '';
		
	if (!user_name) {
		dataOk = false;
		invalidParam = 'user_name';
	}else if (!plan) {
		dataOk = false;
		invalidParam = 'plan';
	}

	if (dataOk){

		var query  = Agents.where({user_name: user_name});

		query.findOne(function (err, agent) {
			if(err){
				res.statusCode = params.error_response_code
				res.end("Error: " + err);				
			}else{

				if (agent == null){
					res.statusCode = params.error_response_code
					res.end("No record found: " + err);
				}else{

					if (overwrite){
						
						Agents.update({ user_name: user_name }, { $set: { like_plans: plan}}).exec();

					}else{

						if (agent.like_plans){

							Agents.update({ user_name: user_name }, { $set: { like_plans: agent.like_plans + ", " + plan}}).exec();

						}else{
							Agents.update({ user_name: user_name }, { $set: { like_plans: plan}}).exec();
						}
					}
					
					res.end ('Ok');

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

	var time_stamp = req.query.time_stamp;


	var dataOk = true,
	invalidParam = '';
		
	if (!time_stamp) {
		dataOk = false;
		invalidParam = 'time_stamp';
	}

	if (dataOk){

		//get all subscribers

		var query  = LikeSubscribers.where({"is_active":"true"});		
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
						var randomIndex = Math.floor((Math.random() * activeAgentTokens.length));

						//console.log("URL IS!!!: " + "https://api.instagram.com/v1/users/" + subscriber[i].user_id + "/media/recent/?access_token=" + activeAgentTokens[randomIndex] + "&count=50&min_timestamp=" + time_stamp);

						var options1 = {
							url: "https://api.instagram.com/v1/users/" + subscriber[i].user_id + "/media/recent/?access_token=" + activeAgentTokens[randomIndex] + "&count=50&min_timestamp=" + time_stamp
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

								console.log("Media length " + mediadata.length);

								if(mediadata.length > 0){

									for (x = 0; x < mediadata.length; x++) { 

										for (k = 0; k < activeAgentTokens.length; k++) { 

											console.log("Image: " + mediadata[x].id + ", Token " + activeAgentTokens[k]);

											/*
											request.post(
											    "https://api.instagram.com/v1/media/" + mediadata[x].id + "/likes",
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
											); */
											
										}
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
			url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&access_token=" + params.default_instagram_api_access_token + "&count=1" 
		};

		request(options, function (error, response, body) {

			if (error){
				errmsg = "Instagram API error: " + error;
				logger.error(errmsg + ", like subscriber name: " + user_name);	

				res.statusCode = params.error_response_code;
				res.end ("error connecting to Instagram");
							
			} else if (response && response.statusCode != 200) {
				errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
				logger.error(errmsg  + ", ike subscriber: " + user_name);

				res.statusCode = params.error_response_code;
				res.end ("error connecting to Instagram");

			}else{

				var userdata = (JSON.parse(body)).data;
				if (userdata.length > 0){


					if (subscription_plan == "FREE"){

						LikeSubscribers.findOne(
							{user_id: userdata[0].id},  
							function (err, likesubscriber) {

								if(err) {
									logger.error("Error search for Like Subscriber in Mongo:  " + err);
									
									res.statusCode = params.error_response_code;
									res.end ("error connection to promogram data");

								}else if (likesubscriber == null){

									//logger.info("New User!");
									//logger.info("User data: " + userdata[0].username);
									//logger.info("Subscription plan: " + subscription_plan);

									addLikeSubscribers(userdata[0].id, userdata[0].username, subscription_plan, email, '', function (error){

										if(error){
											res.statusCode = params.error_response_code;
											res.end (error);
										}else{
											var result = { "result": "free" };
											res.end (JSON.stringify(result));
										}

									});
									
								}else{
									logger.info("User already subscribed to free service and cannot re-subscribe");
									
									res.statusCode = params.error_response_code;
									res.end (userdata[0].username + " is already subscribed to a " + likesubscriber.subscription_plan + " plan");
								}
						});

						
					}else {

						LikeSubscribers.findOne(
							{user_id: userdata[0].id, is_active: true},  
							function (err, likesubscriber) {

								if(err) {
									logger.error("Error search for Like Subscriber in Mongo:  " + err);
									
									res.statusCode = params.error_response_code;
									res.end ("error connection to promogram data");

								}else if ((likesubscriber == null) || (likesubscriber.payment_id == '')){
	
									var result = { "result": "stripe", "user_id" : userdata[0].id};
									res.end (JSON.stringify(result));
													
								}else{
									logger.info("User is already subscribed to another plan, please cancel the plan first");
									
									res.statusCode = params.error_response_code;
									res.end (userdata[0].username + " is already subscribed to a " + likesubscriber.subscription_plan + " plan, please cancel that plan and try again");
								}
						});


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
			url: "https://api.instagram.com/v1/users/search?q=" + user_name + "&access_token=" + params.default_instagram_api_access_token + "&count=1" 
		};

		request(options, function (error, response, body) {

			if (error){
				errmsg = "Instagram API error: " + error;
				logger.error(errmsg + ", like subscriber name: " + user_name);	

				res.statusCode = params.error_response_code;
				res.end ("error connecting to Instagram");
							
			} else if (response && response.statusCode != 200) {
				errmsg = "Instagram API error: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";		    				
				logger.error(errmsg  + ", like subscriber: " + user_name);

				res.statusCode = params.error_response_code;
				res.end ("error connecting to Instagram");

			}else{

				var userdata = (JSON.parse(body)).data;
				if (userdata.length > 0){										

					//no need to get any feedback from mongo write
					LikeSubscribers.update({ user_id: userdata[0].id }, { $set: { is_active: false , payment_id: '', cancel_email_sent: false, cancel_reminder_sent: false}}).exec();

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


router.post('/api/charge', function(req, res) {

  	var stripeToken = req.body.stripeToken;
  	var stripeEmail = req.body.stripeEmail;
  	var plan = req.body.stripe_form_plan;
  	var user_name = req.body.stripe_form_user_name;
  	var user_id = req.body.stripe_form_user_id;
  	var amount;
  	var likes_count = 100;

  	//console.log("stripeToken: " + stripeToken);
  	//console.log("stripeEmail: " + stripeEmail);
  	//console.log("plan: " + plan);
  	//console.log("user_name: " + user_name);
  	//console.log("user_id: " + user_id);
  
  	if (plan == "BRONZE"){			
		likes_count = 150;	
		amount = 1999;				
	}else if (plan == "SILVER"){
		likes_count = 250;	
		amount = 2499;	
	}else if (plan == "GOLD"){
		likes_count = 500;	
		amount = 4499;	
	}

	//overwrite amount for test purposes
	amount = 200;

	// Set your secret key: remember to change this to your live secret key in production
	// See your keys here https://dashboard.stripe.com/account/apikeys
	var stripe = require("stripe")(params.stripe_api_secret_key);

	var charge = stripe.charges.create({
	  amount: amount, // amount in cents, again
	  currency: "usd",
	  source: stripeToken,
	  description: "user: " + user_name + ", email: " + stripeEmail
	}, function(err, charge) {
		if (err && err.type === 'StripeCardError') {
	    	// The card has been declined
	    	res.redirect("/home?status=error&message=" + encodeURI("credit card has been declined")); 
	    	logger.info("card has been declined" );
	  	}else if (err){
	  		res.redirect("/home?status=error"); 
	  		logger.error("Error charging card: " + JSON.stringify(err));
	  	}else{

	  		logger.info("Card charge successful for " + user_name +", will attempt to add subscriber to our data base" );

			addLikeSubscribers(user_id, user_name, plan, stripeEmail, stripeToken, function (error){
				
				if(error){
					logger.error("Add subscriber was not successul but payment was successful (will attempt to reverse payment): " + error);
      				
      				stripe.charges.createRefund(
					  charge.id,
					  {},
					  function(err, refund) {
					  }
					);

      				res.redirect("/home?status=error&message=" + encodeURI("oops! subscription failed, if your card was charged, an automatic refund has been initiated. please try again...")); 
				}else{
					logger.info("Add subscriber was successfull");

					var expiration_date = new Date();
					expiration_date.setDate(expiration_date.getDate() + 30);

					//send success email
					app.mailer.send('email-plan', 
						{
				    		to: stripeEmail, 
				    		subject: 'Promogram Subscription Successful', 
				    		user_name: user_name,
				    		charge_id: charge.id, 
							plan: plan, 
							likes_count: likes_count,
							expiration_date: expiration_date,
							amount: amount / 100
				  		}, function (err) {
					    	if (err) {
					      		logger.error("Error while sending confirmation email " + err);
					      
					    	}
					  });

					res.redirect("/home?status=success");
				}

			});

	  	}
	});
	
});


router.get('/api/clean_up_like_subscribers', function(req, res) {
	
	//get all subscribers

	var query  = LikeSubscribers.where({"is_active":"true"});		
	query.find(function (err, subscriber) {
		if(err){
			logger.error("Error getting Like Subscribers: " + error);		
		}else{

			if (subscriber == null){
				logger.error("Error Like Subscribers: Result returned null");	
			}else{

				var i; 
				for (i in subscriber) {

					//subscriber[i].user_id

					var _MS_PER_DAY = 1000 * 60 * 60 * 24;
					var expiration_date_utc = Date.UTC(subscriber[i].subscription_end.getUTCFullYear(), subscriber[i].subscription_end.getUTCMonth(),subscriber[i].subscription_end.getUTCDate());
					var today_utc = new Date();
					today_utc = Date.UTC(today_utc.getUTCFullYear(), today_utc.getUTCMonth(), today_utc.getUTCDate());

					var date_diff = Math.floor((expiration_date_utc - today_utc) / _MS_PER_DAY);

					logger.info("Subscriber: " + subscriber[i].user_name + " has " + date_diff + " subscription day(s) left" );
					
					if(date_diff <= 0){
						//cancelation zone

						if (!subscriber[i].cancel_email_sent){
							logger.info("Subscriber: " + subscriber[i].user_name + ": subscription cancelled and email notification sent");

							//no need to get any feedback from mongo write
							LikeSubscribers.update({ user_id: subscriber[i].user_id }, { $set: { is_active: false , payment_id: '', cancel_email_sent: true}}).exec();

							//send cancel email

							if (subscriber[i].email && (subscriber[i].email != '')){
								app.mailer.send('email-subscription-cancel', 
									{
							    		to: subscriber[i].email, 
							    		subject: 'Promogram Subscription Cancellation', 
							    		user_name: subscriber[i].user_name,
										plan: subscriber[i].subscription_plan
							  		}, function (err) {
								    	if (err) {
								      		logger.error("Error while sending confirmation email " + err);
								      
								    	}
								  });
							}


						}else{
							logger.info("Subscriber: " + subscriber[i].user_name + ": subscription already cancelled");
						}

					}else if((date_diff > 0) && (date_diff <= 3) && (subscriber[i].subscription_plan != "FREE")){
						//reminder zone

						if (!subscriber[i].cancel_reminder_sent){
							logger.info("Subscriber: " + subscriber[i].user_name + ": cancel reminder email has never been sent, lets send it");

							//no need to get any feedback from mongo write
							LikeSubscribers.update({ user_id: subscriber[i].user_id }, { $set: { cancel_reminder_sent: true}}).exec();

							//send cancel reminder email

							if (subscriber[i].email && (subscriber[i].email != '')){
								app.mailer.send('email-subscription-cancel-reminder', 
									{
							    		to: subscriber[i].email, 
							    		subject: 'Reminder: Promogram Subscription Cancellation', 
							    		user_name: subscriber[i].user_name,
										plan: subscriber[i].subscription_plan,
										expiration_date: subscriber[i].subscription_end
							  		}, function (err) {
								    	if (err) {
								      		logger.error("Error while sending confirmation email " + err);
								      
								    	}
								  });
							}

						}else{
							logger.info("Subscriber: " + subscriber[i].user_name + ": cancel reminder email already been sent");

						}
					}
					
				}
			}
		}
	});
	
	res.end ('Subscriber clean up initiated');

});



router.get('/home', function(req, res) {

	var status = req.query.status;

	fs.readFile('./www/index.html', 'utf8', function (err,data) {
		if (!err) {

			var message = '';

			if (status && (status == "success")){
				var message = req.query.message || "Congratulations, you have successfully registered, enjoy en masse likes on your new instagram posts!";
			}else if (status && (status == "error")){
				var message = req.query.message || "oops! an error occurred, please try again...";
			}

			res.end((String(data).replace('@subscription_result',status)).replace('@subscription_message',message));

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

router.get('/', function(req, res) {
	res.sendFile(process.cwd() + "/www/index.html");	
});

// Register all our routes with /
app.use('/', router);


//---------------------------
//  FUNCTIONS 
//---------------------------

function addLikeSubscribers(user_id, user_name, subscription_plan, email, payment_id, callback){
	
	var options1 = {
		url: "https://api.instagram.com/v1/users/" + user_id + "/?access_token=" + params.default_instagram_api_access_token
	};

	request(options1, function (error1, response1, body1) {

		if (error1){
			errmsg = "Instagram API error: " + error1;
			logger.error(errmsg  + ", user name: " + user_name);

			callback("error connecting to Instagram");

		} else if (response1 && response1.statusCode != 200) {
			errmsg = "Instagram API error: " + http.STATUS_CODES[response1.statusCode] + " (" + response1.statusCode + ")";		    				
			logger.error(errmsg +  ", user name: " + user_name);

			callback("error connecting to Instagram");

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
					payment_id: payment_id,
					cancel_email_sent: false,
					cancel_reminder_sent: false,
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



