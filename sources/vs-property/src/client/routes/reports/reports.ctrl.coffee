'use strict'

angular.module 'vsProperty'
.controller 'ReportsCtrl', ($scope, $interval, $http, auth, dezrez) ->
  $scope.auth = auth
  $scope.getProperties = dezrez.getProperties
  $scope.loading = dezrez.loading