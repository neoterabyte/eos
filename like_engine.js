var db = require('./shared/lib/db');
var params = require('./shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('./shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');
var url = require('url');

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


function startLikeEngine (agent, timeout, reset_last_access){

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

							logger.info("LIKEENGINE: all subscriber data popped for agent: " + agent.user_name + " from redis, reloading...");

							var i; 					
							//load keys
							for (i in subscribers) {

								//put subscriber in queue
								cache.sadd(cache_agent_subscriber_queue, subscribers[i].user_id, function (){});
								
							}                                    

							setTimeout(function(){ logger.info("LIKEENGINE: " +  agent.user_name + " has woken up"); startLikeEngine(agent, timeout, false); }, timeout);
						}
					}
				});

			}else{

				var cache_agent_subscriber_last_access_time = params.cache_prefix + "agent:" + agent.user_name + ":subscriber:" + subscriber + ":last_access_time";

				cache.get (cache_agent_subscriber_last_access_time, function (err, last_access){

					var last_access_time;

					if (err){
						logger.error("Error getting last access time for by agent on subscriber" + err);

					}else if ((last_access == null) || (reset_last_access)){	

						var last_access_date =  new Date();
						last_access_date.setDate(last_access_date.getDate() - 100); //set default last access time to yesterday
						last_access_time = Math.floor(last_access_date / 1000);
						
					}else{
						last_access_time = last_access;
					}

					cache.set (cache_agent_subscriber_last_access_time, Math.floor(Date.now() / 1000) ,  function (){});
					cache.expire (cache_agent_subscriber_last_access_time, 86400, function (){}); //set this key to expire after one day

					logger.info("LIKEENGINE: start agent liking: " + agent.user_name + ", on subscriber: " + subscriber + ", last access: " + last_access_time);

					
					var options1 = {
						url: "https://api.instagram.com/v1/users/" + subscriber + "/media/recent/?access_token=" + agent.access_token + "&count=10&min_timestamp=" + last_access_time
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

							for (x = 0; x < mediadata.length; x++) { 
										
								request.post(
								    "https://api.instagram.com/v1/media/" + mediadata[x].id + "/likes",
								    { form: { 
								    	access_token: agent.access_token
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
					});

					setTimeout(function(){ logger.info("LIKEENGINE: " + agent.user_name + " has woken up"); startLikeEngine(agent, timeout, false); }, timeout);

				});

			}

		});
	}
	
}




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



