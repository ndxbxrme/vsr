'use strict'

angular.module 'vs-maintenance'
.config ($stateProvider) ->
  $stateProvider.state 'profile',
    url: '/profile'
    templateUrl: 'routes/profile/profile.html'
    controller: 'ProfileCtrl'
    resolve:
      user: (Auth) ->
        Auth.getPromise(['agency','maintenance','admin','superadmin'])