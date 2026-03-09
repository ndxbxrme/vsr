'use strict'

angular.module 'vs-maintenance'
.config ($stateProvider) ->
  $stateProvider.state 'forgot',
    url: '/forgot'
    templateUrl: 'routes/forgot/forgot.html'
    controller: 'ForgotCtrl' 