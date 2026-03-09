'use strict'

angular.module 'vsProperty'
.controller 'DashboardCtrl', ($scope, $interval, $http, auth, dezrez) ->
  $scope.auth = auth
  $scope.getProperties = dezrez.getProperties
  $scope.loading = dezrez.loading
  
  # Filter for current properties only
  $scope.isCurrentProperty = (property) ->
    status = property?.details?.RoleStatus?.SystemName
    console.log 'Property Status:', property?.Address?.Street, 'SystemName:', status, 'DisplayName:', property?.details?.RoleStatus?.DisplayName
    status is 'InstructionToSell' or status is 'UnderOffer' or status is 'OfferAccepted'
  
  $scope.getSalutation = ->
    hours = new Date().getHours()
    if hours < 12
      return 'Good Morning'
    else if hours < 17
      return 'Good Afternoon'
    'Good Evening'
  
  $scope.getProgressionPercent = (property) ->
    totalMilestones = 0
    noCompleted = 0
    if property and property.progressions
      for progression in property.progressions
        for branch in progression.milestones
          for milestone in branch
            totalMilestones++
            if milestone.completed
              noCompleted++
      if totalMilestones > 0
        return Math.floor noCompleted / totalMilestones * 100
    return 0