'use strict'

angular.module 'vs-maintenance'
.controller 'ProfileCtrl', ($scope, Auth) ->
  $scope.profile = $scope.single 'users', Auth.getUser()._id