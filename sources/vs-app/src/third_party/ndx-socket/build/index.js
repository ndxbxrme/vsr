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

  module.factory('socket', function($http) {
    var socket;
    socket = io();
    return socket;
  });

}).call(this);

//# sourceMappingURL=index.js.map
