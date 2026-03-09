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

  module.factory('alert', function() {
    return {
      log: function(msg) {
        return humane.log(msg);
      }
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
