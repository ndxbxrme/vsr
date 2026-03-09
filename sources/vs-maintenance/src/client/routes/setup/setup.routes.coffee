'use strict'

angular.module 'vs-maintenance'
.config ($stateProvider) ->
  $stateProvider.state 'setup',
    url: '/setup'
    templateUrl: 'routes/setup/setup.html'
    controller: 'SetupCtrl'
    resolve:
      user: (Auth) ->
        Auth.getPromise(['admin', 'superadmin'])