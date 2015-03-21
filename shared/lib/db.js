// Retrieve or create database object
var getModel = function(obj, callback) {
  var mongoConfig = require('../config/mongo.json');
  var mongoose = require('mongoose');
  var Schema = mongoose.Schema;

  var Log = require('log');
  var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');

  if (!mongoose.models[obj]) {
    var uristring = 'mongodb://' + mongoConfig.host + '/piper'; 
    

    // Connect to mongodb
    if (!mongoose.connection.db) {
        mongoose.connect(uristring, function (err, res) {
        if (err) {
          logger.error ('ERROR connecting to: ' + uristring + '. ' + err);
        } else {
          logger.info ('Successfully connected to: ' + uristring);
        }

      });
    }

    // Create schema
    try {
      var schemaObject = require('../schemas/' + obj + '.json');
      // console.log('Valid schema: ' + JSON.stringify(schemaObject));
    } catch(e){
      logger.debug(JSON.stringify(e));
      logger.error('Invalid Schema: ./schemas/' + obj + '.json');
      var schemaObject = {};
    }
    
    // Get (retrieve if existing, create if new) and return a collection
    try {
      var collectionSchema = new Schema(schemaObject);
      var model = mongoose.model(obj, collectionSchema);
      callback('', model);
    } catch (e) {
      // Error loading db
      console.log(e.stack);
      callback('Unable to load collection', e);
    }
    
  } else {
    callback('', mongoose.models[obj]);
  }
  
} 


// Export the Collection constructor from this module.
module.exports.getModel = getModel;




