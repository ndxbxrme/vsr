'use strict'

angular.module 'vsProperty'
.directive 'propertyMenu', ->
  restrict: 'AE'
  templateUrl: 'directives/property-menu/property-menu.html'
  replace: true
  controller: 'ViewCtrl'