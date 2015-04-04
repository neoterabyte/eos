function startLikeEngine (agent, timeout){
	console.log("Agent: " + agent);

	setTimeout(function(){ startLikeEngine(agent, timeout); }, timeout);
}

startLikeEngine("Agent 1", 3000);
startLikeEngine("Agent 2", 3000);
startLikeEngine("Agent 3", 3000);