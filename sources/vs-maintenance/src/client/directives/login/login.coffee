'use strict'

angular.module 'vs-maintenance'
.directive 'login', ($http, $location) ->
  restrict: 'AE'
  templateUrl: 'directives/login/login.html'
  replace: true
  scope: {}
  link: (scope, elem) ->
    scope.login = ->
      scope.submitted = true
      if scope.loginForm.$valid
        $http.post '/api/login',
          email: scope.email
          password: scope.password
        .then (response) ->
          scope.auth.getPromise()
          .then ->
            scope.users.refreshFn()
            scope.auth.goToNext()
        , (err) ->
          scope.message = err.data
          scope.submitted = false
    scope.signup = ->
      scope.submitted = true
      if scope.loginForm.$valid
        $http.post '/api/signup',
          email: scope.email
          password: scope.password
        .then (response) ->
          scope.auth.getPromise()
          .then ->
            scope.users.refreshFn()
            scope.auth.goToNext()
        , (err) ->
          scope.message = err.data
          scope.submitted = false 