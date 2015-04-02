// Fetch latest 10 emails and show the snippet

var Gmail = require('node-gmail-api');
var gmail = new Gmail("ya29.SAHOevTURn81svMZ8ztmAJUHE5mT0LaHUaM2Vx3RnFPnkPOcAfXz50JiW74fGaG0y7CjYIAI67bYWQ");
var s = gmail.messages('label:inbox', {max: 1});

s.on('data', function (d) {
  console.log(d)
})