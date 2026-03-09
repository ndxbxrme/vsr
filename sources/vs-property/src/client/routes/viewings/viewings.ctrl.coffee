'use strict'

angular.module 'vsProperty'
.controller 'ViewingsCtrl', ($scope, $interval, $http, dezrez) ->
  $scope.sort = '-date'
  dezrez.fetchViewings()
  $scope.getProperties = dezrez.getProperties
  $scope.loading = dezrez.loading
  
  # Incomplete viewings (Cancelled or No Show)
  $scope.isIncomplete = (viewing) ->
    status = viewing?.EventStatus?.Name
    status is 'Cancelled' or status is 'No Show'
  
  # Upcoming viewings (future and not cancelled/no show)
  $scope.isUpcoming = (viewing) ->
    return false unless viewing?.StartDate
    status = viewing?.EventStatus?.Name
    return false if status is 'Cancelled' or status is 'No Show'
    
    viewingDate = new Date(viewing.StartDate)
    now = new Date()
    viewingDate > now