'use strict'

angular.module 'vsProperty'
.directive 'header', ($state, auth) ->
  restrict: 'AE'
  templateUrl: 'directives/header/header.html'
  replace: true
  link: (scope, elem) ->
    scope.auth = auth
    scope.getUser = auth.getDezrezUser
    scope.getDezrezUser = ->
      user = auth.getDezrezUser()
      if not user
        return dezrez: ContactName: 'My VitalSpace'
      else
        return user
    scope.isSelected = (route) ->
      if $state and $state.current
        if Object.prototype.toString.call(route) is '[object Array]'
          return route.indexOf($state.current.name) isnt -1
        else
          return route is $state.current.name
      false