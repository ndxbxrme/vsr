'use strict'

angular.module 'vs-maintenance'
.directive 'header', ($rootScope) ->
  restrict: 'EA'
  templateUrl: 'directives/header/header.html'
  replace: true
  link: (scope, elem, attrs) ->
    scope.toggle = ->
      $rootScope.mobileMenuOut = not $rootScope.mobileMenuOut