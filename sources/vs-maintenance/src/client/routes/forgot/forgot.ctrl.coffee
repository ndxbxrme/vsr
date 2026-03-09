'use strict'

angular.module 'vs-maintenance'
.controller 'ForgotCtrl', ($scope, $http, $state) ->
  $scope.token = window.location.search.replace(/^\?/, '')
  $scope.submitEmail = ->
    if $scope.emailForm.$valid
      $http.post '/get-forgot-code',
        email: $scope.email
      .then (response) ->
        true
  $scope.submitPass = ->
    if $scope.repeatPassword is $scope.password
      $http.post "/forgot-update/#{$scope.token}",
        password: $scope.password
      .then (response) ->
        if response.data is 'OK'
          $state.go 'dashboard'
      , (err) ->
        false
    else
      $scope.error = 'Passwords must match'