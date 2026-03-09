'use strict'

angular.module 'vsProperty'
.controller 'PropertiesCtrl', ($scope, $interval, $http, dezrez) ->
  $scope.loading = dezrez.loading
  $scope.getProperties = dezrez.getProperties
  $scope.getFeedbackCount = (property) ->
    count = 0
    for viewing in property.viewings
      count += viewing.Feedback.length
    count