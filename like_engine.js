var db = require('./shared/lib/db');
var params = require('./shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('./shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');
var url = require('url');
var crypto = require('crypto');

// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');


// Retrieve leave context
db.getModel('like_subscribers', function(err, model) {
    if (err) {
        logger.error('Fatal error: ' + err + '. Cannot retrieve like_subscribers schema');
    } else {
        LikeSubscribers = model;
    }   
});

function startLikeEngine (agent, timeout){

	var cache_agent_subscriber_queue = params.cache_prefix + "agent:" + agent.user_name + ":subscriber_queue";
	var cache_agent_status = params.cache_prefix + "agent:" + agent.user_name + ":status"

	if (agent.like_plans){
	
		cache.spop(cache_agent_subscriber_queue, function (err, subscriber){

			if (err) {
				logger.error("Error popping subscriber data for agent" + agent.user_name + " from redis: " + err);	
			}else if ((subscriber == null) || (subscriber.length = 0)){	

				var plans = agent.like_plans.split(",");
				var where = {};

				if (plans.length == 1){
					where = {is_active: true, subscription_plan: plans[0]};
				}else if (plans.length == 2){

					where =  { $and : [ { is_active: true }, { $or : [ { subscription_plan : plans[0] }, { subscription_plan : plans[1] } ] } ] };

				}else if (plans.length == 3){

					where =  { $and : [ { is_active: true }, { $or : [ { subscription_plan : plans[0] }, { subscription_plan : plans[1] }, { subscription_plan : plans[2] } ] } ] };
				}


				//get all subscribers

				var query  = LikeSubscribers.where(where);		
				query.find(function (err, subscribers) {
					if(err){
						logger.error("Error getting Like Subscribers: " + error);		
					}else{

						if (subscribers == null){
							logger.error("Error Like Subscribers: Result returned null");	
						}else{

							//logger.info("LIKEENGINE: all subscriber data popped for agent: " + agent.user_name + " from redis, reloading...");

							var i; 					
							//load keys
							for (i in subscribers) {

								//put subscriber in queue
								cache.sadd(cache_agent_subscriber_queue, subscribers[i].user_id, function (){});
								
							}                                    

							cache.get (cache_agent_status, function (err, agent_status){					
								if (err) {
									logger.error("Error setting agent run status for " + agent.user_name + ": " + err);	
								}else if ((agent_status == null) || (agent_status == "run")){	
									//status doesnt exist, proceed
									setTimeout(function(){ logger.info("LIKEENGINE: " +  agent.user_name + " new cycle"); startLikeEngine(agent, timeout); }, timeout);
									cache.set (cache_agent_status, "run",  function (){});
								}else if (agent_status == "stop"){	
									logger.info("Stopped agent: " + agent.user_name);	
								}
							});
						}
					}
				});

			}else{

				var cache_agent_subscriber_last_access_time = params.cache_prefix + "agent:" + agent.user_name + ":subscriber:" + subscriber + ":last_access_time";

				cache.get (cache_agent_subscriber_last_access_time, function (err, last_access){

						
					if (err){
						logger.error("Error getting last access time for by agent on subscriber" + err);

					}else if (last_access == null){	

						var now = new Date(); 
						var now_utc = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),  now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
					
						last_access_time =  Math.floor(now_utc/ 1000) - 3600; // if reset last access set use last hour
						
					}else{
						last_access_time = last_access;
					}

					logger.info("LIKEENGINE: " + cache_agent_subscriber_last_access_time + ": " + new Date(last_access_time * 1000));

					//set last access time moved to inside callback so its set just after the request to instagram returns
					//cache.set (cache_agent_subscriber_last_access_time, Math.floor(now_utc/ 1000) ,  function (){});
					//cache.expire (cache_agent_subscriber_last_access_time, 86400, function (){}); //set this key to expire after one day
					
					(function(agent) { 

						var signature = "/users/" + subscriber + "/media/recent|access_token=" + agent.access_token + "|count=1|min_timestamp=" + last_access_time;
						var sig = crypto.createHmac('sha256', params.instagram_api.client_secret).update(signature).digest('hex');

						var options1 = {
							url: "https://api.instagram.com/v1/users/" + subscriber + "/media/recent/?access_token=" + agent.access_token + "&count=1&min_timestamp=" + last_access_time +"&sig=" + sig
						};


						request(options1, function (error1, response1, body1) {

							var now1 = new Date(); 
							var now_utc1 = new Date(now1.getUTCFullYear(), now1.getUTCMonth(), now1.getUTCDate(),  now1.getUTCHours(), now1.getUTCMinutes(), now1.getUTCSeconds());
				
							cache.set (cache_agent_subscriber_last_access_time, Math.floor(now_utc1/ 1000) ,  function (){});
							cache.expire (cache_agent_subscriber_last_access_time, 86400, function (){}); //set this key to expire after one day
					
							if (error1){
								errmsg = "Instagram API error: agent: " + agent.user_name + ", error: " + error1;
								logger.error(errmsg);

							} else if (response1 && response1.statusCode != 200) {
								errmsg = "Instagram API error: agent: " + agent.user_name + ", error: " + http.STATUS_CODES[response1.statusCode] + " (" + response1.statusCode + "), details: " + JSON.parse(response1.body).error_message;		    				
								logger.error(errmsg);
		
							}else{
								var mediadata = (JSON.parse(body1)).data;

								//logger.info("Media length " + mediadata.length);

								if (mediadata.length > 0){

									logger.info("LIKEENGINE: start agent liking: " + agent.user_name + ", on subscriber: " + subscriber + ", last access: " + last_access_time + ", remaining api limit: " + response1.headers['x-ratelimit-remaining']);									
																		
									for (x = 0; x < mediadata.length; x++) { 

										var signature = "/media/" + mediadata[x].id + "/likes|access_token=" + agent.access_token;
										var sig = crypto.createHmac('sha256', params.instagram_api.client_secret).update(signature).digest('hex');

										/*
										request.post(
										    "https://api.instagram.com/v1/media/" + mediadata[x].id + "/likes",
										    { form: { 
										    	access_token: agent.access_token,
										    	sig: sig
											} },
										    function (error2, response2, body2) {									        
										    	if (error2){
										    		errmsg = "Instagram like error: " + error2;
										            logger.error(errmsg);
										    	} else if (response2 && response2.statusCode != 200) {
										    		errmsg = "Instagram like error: Invalid response: " + http.STATUS_CODES[response2.statusCode] + " (" + response2.statusCode + "), details: " + JSON.parse(response1.body).error_message;
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
						});
					})(agent);
					cache.get (cache_agent_status, function (err, agent_status){					
						if (err) {
							logger.error("Error setting agent run status for " + agent.user_name + ": " + err);	
						}else if ((agent_status == null) || (agent_status == "run")){	
							//status doesnt exist or status is run, proceed
							setTimeout(function(){ logger.info("LIKEENGINE: " + agent.user_name + " new cycle"); startLikeEngine(agent, timeout); }, timeout);
							cache.set (cache_agent_status, "run",  function (){});
						}else if (agent_status == "stop"){	
							logger.info("Stopped agent: " + agent.user_name);	
						}
					});
					
				});

			}

		});
	}
	
}

module.exports.startLikeEngine = startLikeEngine;

/*
//Test Data

var agent1 = {
	"_id": "551f31e418d55d47997e86b2",
	"user_name": "ericrees681_",
	"is_active": true,
	"access_token": "1526467199.8409d3e.c8ac80a0cd664a0586275cbdbe44b12a",
	"__v": 0,
	"user_id": "1526467199",
	"media_count": 8,
	"follows": 0,
	"followed_by": 0,
	"like_plans": "FREE,SILVER"
};

var agent2 ={
"_id": "551f335218d55d47997e86ba",
"user_name": "maxmathis764_",
"is_active": true,
"access_token": "1526507985.8409d3e.c6c8f75c27044f41962cecd367a2e1f6",
"__v": 0,
"user_id": "1526507985",
"media_count": 7,
"follows": 0,
"followed_by": 0,
"like_plans": "BRONZE,SILVER"
};

var agent3 =
{
"_id": "551f340418d55d47997e86be",
"user_name": "jakeogden613_",
"is_active": true,                           
"access_token": "1526512795.8409d3e.ec4e1d1e35bd4098a4035be0a0734c75",
"__v": 0,
"user_id": "1526512795",
"media_count": 4,
"follows": 0,
"followed_by": 0,
"like_plans": "FREE,BRONZE"
};


cache.del( params.cache_prefix + "agent:" + agent1.user_name + ":subscriber_queue", function (){});
cache.del( params.cache_prefix + "agent:"  + agent2.user_name + ":subscriber_queue", function (){});
cache.del( params.cache_prefix + "agent:"  + agent3.user_name + ":subscriber_queue", function (){});

startLikeEngine(agent1, 7000, true);
startLikeEngine(agent2, 7000, true);
startLikeEngine(agent3, 7000, true);
*/

var agent4 =
{
"_id": "55338b8b18d55d47997e8919",
"user_name": "ericrees681_",
"is_active": true,
"access_token": "1526467199.8409d3e.c8ac80a0cd664a0586275cbdbe44b12a",
"user_id": "1526467199",
"media_count": 0,
"follows": 0,
"followed_by": 0,
"like_plans": "BRONZE, GOLD"
};

var reset = false;

var TIMEOUT = 8000;
if (reset){
	var sys = require('sys');
	var exec = require('child_process').exec;
	exec("redis-cli KEYS \"*" + agent4.user_name + "*\" | xargs redis-cli DEL", function (error, stdout, stderr) {
		startLikeEngine(agent4, TIMEOUT);	
	});
}else{
	startLikeEngine(agent4, TIMEOUT);	
}



