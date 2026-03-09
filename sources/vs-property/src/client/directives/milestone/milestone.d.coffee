'use strict'

angular.module 'vsProperty'
.directive 'milestone', () ->
  restrict: 'AE'
  templateUrl: 'directives/milestone/milestone.html'
  replace: true
  scope:
    milestone: '=data'
    disabled: '@'
  link: (scope, elem, attrs) ->
    scope.getClass = ->
      completed: scope.milestone.completed
      progressing: scope.milestone.progressing
      overdue: if scope.milestone.completed then false else (scope.milestone.progressing and new Date().valueOf() > (scope.milestone.userCompletedTime or scope.milestone.estCompletedTime))
    