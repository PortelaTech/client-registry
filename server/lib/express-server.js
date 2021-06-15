'use strict';
/*global process, __dirname*/
const express = require('express');
const bodyParser = require('body-parser');
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

const userRouter = require('./routes/user');
const fhirRoutes = require('./routes/fhir');
const matchRoutes = require('./routes/match');
const csvRoutes = require('./routes/csv');
const configRoutes = require('./routes/config');
const handlers = require('./express-handlers.js');

const serverOpts = {
  key: fs.readFileSync(`${__dirname}/../serverCertificates/server_key.pem`),
  cert: fs.readFileSync(`${__dirname}/../serverCertificates/server_cert.pem`),
  requestCert: true,
  rejectUnauthorized: false,
  ca: [fs.readFileSync(`${__dirname}/../serverCertificates/server_cert.pem`)]
};
if (config.get('mediator:register')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
}
generalMixin.removeDir(`${__dirname}/../gui/tmp`);

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.json({
  limit: '10Mb',
  type: ['application/fhir+json', 'application/json+fhir', 'application/json']
}));
app.use('/crux', express.static(`${__dirname}/../gui`));
//app.use(handlers.jwtValidator);
//if (!config.get('mediator:register')) {
//  app.use(handlers.certificateValidity);
//}
app.use(handlers.cleanReqPath);
app.use('/user', userRouter);
app.use('/fhir', fhirRoutes);
app.use('/match', matchRoutes);
app.use('/csv', csvRoutes);
app.use('/config', configRoutes);

const port = 4000;
app.listen(port);
console.log(`listening on http://localhost:${port}`);


