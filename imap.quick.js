var Imap = require('imap'),
    inspect = require('util').inspect,
    db = require('./shared/lib/db'),
    Log = require('log');

var TIMEOUT = 60000;
// Initialize logger
var logger = new Log(process.env.PROMOGRAM_LOG_LEVEL || 'info');


// Retrieve leave context
db.getModel('counters', function(err, model) {
    if (err) {
        logger.error('Fatal error: ' + err + '. Cannot retrieve agents schema');
    } else {
        Counters = model;
    }
});


   
   try{
        var imap = new Imap({
            user: 'orders@promogram.me',
            password: 'Dumbled0re*',
            host: 'imap.gmail.com',
            port: 993,
            tls: true
        });

        function openInbox(cb) {
            try{
                imap.openBox('INBOX', true, cb);
            }catch(e){
                 console.log("exception: " + e.stack());
            }
        }

        imap.once('ready', function() {
            
            openInbox(function(err, box) {

                if (err) throw err;

                   var f = imap.seq.fetch("4:*", {
                        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT']
                    });
                    f.on('message', function(msg, seqno) {
                        logger.info('Message #%d', seqno);
                        var prefix = '(#' + seqno + ') ';

                        var body;
                        var plan, user_name, user_fullname, user_email;
                        var subject, from, date;

                        msg.on('body', function(stream, info) {

                            if (info.which === 'TEXT') {
                                //console.log(prefix + 'Body [%s] found, %d total bytes', inspect(info.which), info.size);
                            }

                            subject = '';
                            from = '';
                            date = '';
                            plan = '';
                            user_name = '';
                            user_fullname = '';
                            user_email = '';

                            var buffer = '',
                                count = 0;
                            stream.on('data', function(chunk) {
                                count += chunk.length;
                                buffer += chunk.toString('utf8');

                                if (info.which === 'TEXT') {
                                    //console.log(prefix + 'Body [%s] (%d/%d)', inspect(info.which), count, info.size);
                                }
                            });

                            stream.once('end', function() {
                                if (info.which !== 'TEXT') {
                                    var header = Imap.parseHeader(buffer);

                                    subject = new String(header.subject ? header.subject[0] : header.undefinedsubject);
                                    from = new String(header.from ? header.from[0] : header.undefinedfrom);
                                    date = new String(header.date ? header.date[0] : header.undefineddate);

                                    //console.log(prefix + 'Header: %s', JSON.stringify(header));         

                                } else {

                                    body = new String(buffer);
                                    //console.log(prefix + 'buffer: %s', buffer);
                                }
                            });
                        });
                        msg.once('attributes', function(attrs) {
                            //console.log(prefix + 'Attributes: %s', inspect(attrs, false, 8));
                        });
                        msg.once('end', function() {

                            //console.log(prefix + 'Finished');

                            if (body && subject && (subject.indexOf('Notification of payment received') >= 0)) {

                                //extract users details
                                var lines = body.split(/\r\n|[\n\r\u0085\u2028\u2029]/g);
                                var uname_and_plan_obtained = false;
                                var fullname_and_email_obtained = false;

                                for (i = 0; i < lines.length; i++) {
                                    if (lines[i].indexOf("Description:") >= 0) {
                                        var tmp = lines[i].split(',');
                                        plan = (tmp[0].split(':'))[1].trim();
                                        user_name = (tmp[1].split(':'))[1].trim();
                                        uname_and_plan_obtained = true;
                                    }

                                    if (lines[i].indexOf("Buyer:") >= 0) {
                                        var tmp = lines[i].split(',');
                                        user_fullname = lines[i + 1].trim();
                                        user_email = lines[i + 2].replace('=40', '@').trim();
                                        fullname_and_email_obtained = true;
                                    }

                                    if (uname_and_plan_obtained && fullname_and_email_obtained) {
                                        break;
                                    }
                                }

                                //console.log(prefix + 'Subject: %s', subject);
                                //console.log(prefix + 'From: %s', from);
                                //console.log(prefix + 'Date: %s', date);
                                //console.log(prefix + 'plan: ', plan);
                                //console.log(prefix + 'user_name: ', user_name);
                                //console.log(prefix + 'user_fullname: ', user_fullname);
                                //console.log(prefix + 'user_email: ', user_email);

                                console.log(body);

                            }

                        });
                    });
                    f.once('error', function(err) {
                        console.log('Fetch error: ' + err);
                    });
                    f.once('end', function() {
                        console.log('Done fetching all messages!');
                       imap.end();
                    });
                            
            });

        });

        imap.once('error', function(err) {
            console.log(err);
        });

        imap.once('end', function() {
            console.log('Connection ended');
        });

        imap.connect();

    }catch (e){
        console.log("exception: " + e.stack());
    }

