'use strict'

angular.module 'vs-maintenance'
.config ($stateProvider) ->
  $stateProvider
  .state 'dashboard',
    url: '/'
    templateUrl: 'routes/dashboard/dashboard.html'
    controller: 'DashboardCtrl'
    resolve:
      user: (Auth) ->
        Auth.getPromise()