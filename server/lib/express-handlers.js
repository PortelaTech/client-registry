'use strict';
const prerequisites = require('./prerequisites');
const medUtils = require('openhim-mediator-utils');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const https = require('https');
const cacheFHIR = require('./tools/cacheFHIR');
const generalMixin = require('./mixins/generalMixin');
const logger = require('./winston');
const config = require('./config');
const mediatorConfig = require(`${__dirname}/../config/mediator`);

let authorized = false;

const jwtValidator = function (req, res, next) {
    if (!req.path.startsWith('/ocrux')) {
      return next();
    }
    if (req.method == 'OPTIONS' ||
      req.path === '/ocrux/user/authenticate'
    ) {
      authorized = true;
      return next();
    }
    if (!req.headers.authorization || req.headers.authorization.split(' ').length !== 2) {
      logger.error('Token is missing');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('WWW-Authenticate', 'Bearer realm="Token is required"');
      res.set('charset', 'utf - 8');
      res.status(401).json({
        error: 'Token is missing',
      });
    } else {
      const tokenArray = req.headers.authorization.split(' ');
      const token = req.headers.authorization = tokenArray[1];
      jwt.verify(token, config.get('auth:secret'), (err, decoded) => {
        if (err) {
          logger.warn('Token expired');
          res.set('Access-Control-Allow-Origin', '*');
          res.set('WWW-Authenticate', 'Bearer realm="Token expired"');
          res.set('charset', 'utf - 8');
          res.status(401).json({
            error: 'Token expired',
          });
        } else {
          authorized = true;
          if (req.path == '/ocrux/isTokenActive/') {
            res.set('Access-Control-Allow-Origin', '*');
            res.status(200).send(true);
          } else {
            return next();
          }
        }
      });
    }
};
const certificateValidity =   function(req, res, next) {
    if (req.path.startsWith('/ocrux')) {
      return next();
    }
    if(authorized) {
      return next();
    }
    const cert = req.connection.getPeerCertificate();
    if (req.client.authorized) {
      if (!cert.subject.CN) {
        logger.error(`Client has submitted a valid certificate but missing Common Name (CN)`);
        return res.status(400).send(`You have submitted a valid certificate but missing Common Name (CN)`);
      }
    } else if (cert.subject) {
      logger.error(`Client ${cert.subject.CN} has submitted an invalid certificate`);
      return res.status(403).send(`Sorry, you have submitted an invalid certificate, make sure that your certificate is signed by client registry`);
    } else {
      logger.error('Client has submitted request without certificate');
      return res.status(401).send(`Sorry, you need to provide a client certificate to continue.`);
    }
    next();
};
const cleanReqPath = function(req, res, next) {
    req.url = req.url.replace('ocrux/', '');
    return next();
};
//  start the mediator
const reloadConfig = function (data, callback) {
  const tmpFile = `${__dirname}/../config/tmpConfig.json`;
  fs.writeFile(tmpFile, JSON.stringify(data, 0, 2), err => {
    if (err) {
      throw err;
    }
    config.file(tmpFile);
    return callback();
  });
};
const start = function (callback) {
  if (config.get('mediator:register')) {
    logger.info('Running client registry as a mediator');
    medUtils.registerMediator(config.get('mediator:api'), mediatorConfig, err => {
      if (err) {
        logger.error('Failed to register this mediator, check your config');
        logger.error(err.stack);
        process.exit(1);
      }
      config.set('mediator:api:urn', mediatorConfig.urn);
      medUtils.fetchConfig(config.get('mediator:api'), (err, newConfig) => {
        if (err) {
          logger.info('Failed to fetch initial config');
          logger.info(err.stack);
          process.exit(1);
        }
        const env = process.env.NODE_ENV || 'development';
        const configFile = require(`${__dirname}/../config/config_${env}.json`);
        const updatedConfig = Object.assign(configFile, newConfig);
        reloadConfig(updatedConfig, () => {
          config.set('mediator:api:urn', mediatorConfig.urn);
          logger.info('Received initial config:', newConfig);
          logger.info('Successfully registered mediator!');
          prerequisites.init((err) => {
            if (err) {
              process.exit();
            }
            if (config.get("matching:tool") === "elasticsearch") {
              const runsLastSync = config.get("sync:lastFHIR2ESSync");
              cacheFHIR.fhir2ES({
                lastSync: runsLastSync
              }, (err) => {});
            }
          });
          const app = appRoutes();
          const port = config.get('app:port');
          console.log(`Listen on ${port}`);
          const server = app.listen(port, () => {
            const configEmitter = medUtils.activateHeartbeat(config.get('mediator:api'));
            configEmitter.on('config', newConfig => {
              logger.info('Received updated config:', newConfig);
              const updatedConfig = Object.assign(configFile, newConfig);
              reloadConfig(updatedConfig, () => {
                prerequisites.init((err) => {
                  if (err) {
                    process.exit();
                  }
                  if (config.get("matching:tool") === "elasticsearch") {
                    const runsLastSync = config.get("sync:lastFHIR2ESSync");
                    cacheFHIR.fhir2ES({
                      lastSync: runsLastSync
                    }, (err) => {});
                  }
                });
                config.set('mediator:api:urn', mediatorConfig.urn);
              });
            });
            callback(server);
          });
        });
      });
    });
  } else {
    logger.info('Running client registry as a stand alone');
    const app = appRoutes();
    const server = https.createServer(serverOpts, app).listen(config.get('app:port'), () => {
      prerequisites.init((err) => {
        if (err) {
          process.exit();
        }
        if (config.get("matching:tool") === "elasticsearch") {
          const runsLastSync = config.get("sync:lastFHIR2ESSync");
          cacheFHIR.fhir2ES({
            lastSync: runsLastSync
          }, (err) => {});
        }
      });
      logger.info('Now run server');
      callback(server);
    });
  }
};

module.exports = {
    jwtValidator,
    certificateValidity,
    cleanReqPath,
    reloadConfig,
    start,
  }
  