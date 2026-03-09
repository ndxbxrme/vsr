'use strict'

angular.module 'vs-maintenance'
.controller 'SetupCtrl', ($scope, $http, alert) ->
  $scope.jobtypes = $scope.single 'jobtypes',
    type: 'default'
  $scope.jobCallbacks = [{
    name: 'change'
    callback: ->
      $scope.jobtypes.save()
  }]
  $scope.users = $scope.list 'users'
  $scope.addUser = ->
    $scope.newUser.roles = {}
    $scope.newUser.roles[$scope.newUser.role] = {}
    delete $scope.newUser.role
    $http.post '/api/get-invite-code', $scope.newUser
    .then (response) ->
      $scope.inviteUrl = response.data
      alert.log 'Invite sent'
    , (err) ->
      $scope.inviteError = err.data
    $scope.newUser =
      role: 'agency'
  $scope.copyInviteToClipboard = ->
    $('.invite-url input').select()
    alert.log 'Copied to clipboard'
    document.execCommand 'copy'