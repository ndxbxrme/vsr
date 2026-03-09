'use strict'

angular.module 'vs-maintenance'
.directive 'menu', ($state) ->
  restrict: 'EA'
  templateUrl: 'directives/menu/menu.html'
  replace: false
  link: (scope, elem, attrs) ->