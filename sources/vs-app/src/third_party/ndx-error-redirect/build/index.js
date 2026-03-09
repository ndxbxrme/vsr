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

  module.provider('ErrorRedirect', function() {
    var loggedOutState, maintenanceState;
    loggedOutState = 'logged-out';
    ({
      loggedOutState: function(_loggedOutState) {
        return loggedOutState = _loggedOutState;
      }
    });
    maintenanceState = 'maintenance';
    return {
      maintenanceState: function(_maintenanceState) {
        return maintenanceState = _maintenanceState;
      },
      $get: function($state, $q) {
        return {
          responseError: function(rejection) {
            if ($state.current.name) {
              if (rejection.status === 401) {
                if ($state.current.name !== loggedOutState) {
                  $state.go(loggedOutState);
                }
              }
              if (rejection.status === 503) {
                if ($state.current.name !== maintenanceState) {
                  $state.go(maintenanceState);
                }
              }
            }
            return rejection;
          }
        };
      }
    };
  }).config(function($httpProvider) {
    return $httpProvider.interceptors.unshift('ErrorRedirect');
  });

}).call(this);

//# sourceMappingURL=index.js.map
