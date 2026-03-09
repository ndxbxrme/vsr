'use strict'

angular.module 'vsProperty'
.directive 'propertyHeader', ->
  restrict: 'AE'
  templateUrl: 'directives/property-header/property-header.html'
  replace: true
  controller: 'NavCtrl'