'use strict'

angular.module 'vsProperty'
.controller 'ConveyancingCtrl', ($scope, dezrez) ->
  ###
  $('#whytEmbed').detach().appendTo('#whytPlaceholder')
  $scope.$on '$destroy', ->
    $('#whytEmbed').detach().appendTo('#whytDock')
  ###
  $scope.getProperties = dezrez.getProperties
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
    Math.floor noCompleted / totalMilestones * 100