'use strict'

angular.module 'vs-maintenance'
.controller 'DashboardCtrl', ($scope, $compile, TaskPopup) ->
  userFormat = (data) ->
    if user = $scope.selectById $scope.users.items, data.id
      $compile("<img gravatar-src='\"#{user.local.email}\"' /> <span>#{user.displayName or user.local.email}</span>") $scope
  $scope.userSelectOptions =
    minimumResultsForSearch: Infinity
    formatResult: userFormat
    formatSelection: userFormat
    theme: 'usertheme'
    containerCssClass: ':all:'
  $scope.hidePopup = ->
    TaskPopup.hide()
  $scope.today = new Date()