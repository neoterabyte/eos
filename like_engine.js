var db = require('./shared/lib/db');
var params = require('./shared/config/params.json');
var express = require('express');
var Log = require('log');
var cache = require('./shared/lib/cache').getRedisClient();
var request = require('request');
var http = require('http');
var url = require('url');

var cache_prefix = params.cache_prefix + "agent:";

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


	if (agent.like_plans){

	
		cache.rpop(cache_prefix + agent.user_name, function (err, subscriber){

			if (err){
				logger.error("Error popping subscriber data for agent" + agent.user_name + " from redis: " + err);	
			}else if (subscriber == null){	

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

							logger.info("All subscriber data popped for agent: " + agent.user_name + " from redis, beginning reloading");

							var i; 					
							//load keys
							for (i in subscribers) {

								var last_access_time;

								if (subscribers[i].last_access_time){
									last_access_time = subscribers[i].last_access_time;
								}else{
									var last_access_date =  new Date();
									last_access_date.setDate(last_access_date.getDate() - 1); //set default last access time to yesterday
									last_access_time = Math.floor(last_access_date / 1000);
								}

								//update the last access time to now
								LikeSubscribers.update({ user_id: subscribers[i].user_id }, { $set: { last_access_time: Math.floor(Date.now() / 1000) }}).exec();


								cache.lpush(cache_prefix + agent.user_name, subscribers[i].user_id + "::" + last_access_time, function (){});
								
							}                                    

							setTimeout(function(){ startLikeEngine(agent, timeout); }, timeout);
						}
					}
				});

			}else{

				var subscriber_details =  subscriber.split("::");
				var subscriber_id = subscriber_details[0];
				var last_access_time = subscriber_details[1];

				logger.info("Beginning liking from agent: " + agent.user_name + ", on subscriber: " + subscriber_id + ", last access: " + last_access_time);

				logger.info("...");
				logger.info("...");
				logger.info("...");

				logger.info("liking done: " + agent.user_name + ", on subscriber: " + subscriber_id + ", entering into sleep... ");

				setTimeout(function(){ logger.info(agent + " has woken up"); startLikeEngine(agent, timeout); }, timeout);

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
	"like_plans": "FREE"
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
"like_plans": "FREE,SILVER"
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
"like_plans": "FREE,SILVER,GOLD"
};

cache.del(cache_prefix + agent1.user_name, function (){});
cache.del(cache_prefix + agent2.user_name, function (){});
cache.del(cache_prefix + agent3.user_name, function (){});

//startLikeEngine(agent1, 910000);
//startLikeEngine(agent2, 7000);
startLikeEngine(agent3, 7000);



