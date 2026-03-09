'use strict'

angular.module 'vs-maintenance'
.controller 'InvitedCtrl', ($scope, $state, $http) ->
  code = window.location.search.replace(/^\?/, '')
  $scope.acceptInvite = ->
    if $scope.repeatPassword is $scope.newUser.local.password
      $http.post '/invite/accept', 
        code: decodeURIComponent code
        user: $scope.newUser
      .then (response) ->
        if response.data is 'OK'
          $state.go 'dashboard'
      , (err) ->
        false
    else
      $scope.error = 'Passwords must match'