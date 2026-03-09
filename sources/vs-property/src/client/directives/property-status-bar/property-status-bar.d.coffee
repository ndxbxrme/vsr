'use strict'

angular.module 'vsProperty'
.directive 'propertyStatusBar', ($state, $timeout, $rootScope, dezrez) ->
  restrict: 'AE'
  templateUrl: 'directives/property-status-bar/property-status-bar.html'
  replace: true
  link: (scope, elem) ->
    scope.$watch ->
      dezrez.loading 'all'
    , (n, o) ->
      if n
        $timeout ->
          if $state and $state.params.propertyID
            scope.property = dezrez.getProperty $state.params.propertyID
        , 1
    $rootScope.$on '$stateChangeSuccess', ->
      if $state and $state.params.propertyID
        scope.property = dezrez.getProperty $state.params.propertyID