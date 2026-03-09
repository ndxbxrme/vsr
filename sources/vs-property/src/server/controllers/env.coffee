'use strict'

module.exports = (ndx) ->
  ndx.app.get '/env.js', (req, res, next) ->
    res.header 'Content-Type', 'application/javascript'
    res.end "
(function() {
  'use strict';
  var e, error, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }
  module.constant('env', {
    CONVEYANCING_URL: '#{process.env.CONVEYANCING_URL}',
    CONVEYANCING_TOKEN: '#{process.env.CONVEYANCING_TOKEN}',
    HOST: '#{process.env.HOST}'
  });
}).call(this);
    "