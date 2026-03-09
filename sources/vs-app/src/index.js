import './third_party/bootstrap-css/css/bootstrap.min.css';
import './index.styl';
const angular = window.angular;
const io = require('socket.io-client');
const RestClient = require('./services/ndx-rest-client.js');
//const bootstrap = require('bootstrap');
window.CodeMirror = require('codemirror');
import 'codemirror/lib/codemirror.css';
window.jade = require('jade');
require('./services/ndx-auth.js');
require('./imports.js');
const serverHost = 'server.vitalspace.co.uk';
const httpProtocol = 'https';
const wsProtocol = 'wss';
//const serverHost = 'localhost:23232';
//const httpProtocol = 'http';
//const wsProtocol = 'ws';
const sites = {
  "main": {
    "displayName": "Main",
    "name": "main",
    "module": "ndx",
    "url": httpProtocol + "://" + serverHost + "/app",
    "ws": "app"
  },
  "lettings": {
    "displayName": "Lettings",
    "name": "lettings",
    "module": "vs-lettings",
    "url": httpProtocol + "://" + serverHost + "/lettings",
    "ws": "lettings"
  },
  "maintenance": {
    "displayName": "Maintenance",
    "name": "maintenance",
    "module": "vs-maintenance",
    "url": httpProtocol + "://" + serverHost + "/maintenance",
    "ws": "maintenance"
  },
  "maintenance_leads": {
    "displayName": "Maintenance Leads",
    "name": "maintenance_leads",
    "module": "vs-maintenance-leads",
    "url": httpProtocol + "://" + serverHost + "/maintenance-leads",
    "ws": "maintenance-leads"
  },
  "agency": {
    "displayName": "Sales",
    "name": "agency",
    "module": "vs-agency",
    "url": httpProtocol + "://" + serverHost + "/agency",
    "ws": "agency"
  },
  "leads": {
    "displayName": "Leads",
    "name": "leads",
    "module": "vs-leads",
    "url": httpProtocol + "://" + serverHost + "/leads",
    "ws": "leads"
  },
  "sms": {
    "displayName": "SMS",
    "name": "sms",
    "module": "vs-sms",
    "url": httpProtocol + "://" + serverHost + "/app",
    "ws": "app"
  },
  "admin": {
    "displayName": "ADMIN",
    "name": "admin",
    "module": "vs-admin",
    "url": httpProtocol + "://" + serverHost + "/admin",
    "ws": "app"
  }
};
const mainmodule = angular.module('vs-app', Object.values(sites).map(site => site.module));
mainmodule.factory('socket', () => {
  return Object.values(sites).reduce((res, site) => {
    if(site.ws) res.push({name:site.name, io:io(wsProtocol + "://" + serverHost + "", {path:'/' + site.ws + '/socket.io', transports:['websocket']})});
    return res;
  }, []);
});
RestClient(mainmodule);
angular.module('vs-lettings').constant('env', {
  PROPERTY_URL: `${httpProtocol}://${serverHost}/property/api`,
  PROPERTY_TOKEN: `U2FsdGVkX1+gN0j3nIuDrf4S1KtTl0vRhxunxFOeDtCZL4szHbINhQMSl3TY+PNFXXcO98NFsIhbVx8rAYArkMQRaW+Yy2jh58LtGwFfwQdp`
})
.run(($rootScope, $http) => {
  $http.sites = sites;
  $http.propertyToken = `U2FsdGVkX1+gN0j3nIuDrf4S1KtTl0vRhxunxFOeDtCZL4szHbINhQMSl3TY+PNFXXcO98NFsIhbVx8rAYArkMQRaW+Yy2jh58LtGwFfwQdp`;
});
require('./imports_local.js');