'use strict'

angular.module 'vsProperty'
.controller 'UnsubCtrl', ($scope, $stateParams, $http, $timeout) ->
  id = $stateParams.id
  $scope.unsubbed = false
  $scope.unsub = ->
    $http.post 'https://server.vitalspace.co.uk/agency/birthday-unsubscribe', id: id
    $timeout ->
      $scope.unsubbed = true