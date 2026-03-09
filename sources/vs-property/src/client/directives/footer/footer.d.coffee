'use strict'

angular.module 'vsProperty'
.directive 'footer', ->
  restrict: 'AE'
  templateUrl: 'directives/footer/footer.html'
  replace: true
  link: (scope) ->
    scope.currentYear = new Date().getFullYear()