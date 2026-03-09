'use strict'

angular.module 'vsProperty'
.directive 'admin', (auth, $window) ->
  restrict: 'AE'
  templateUrl: 'directives/admin/admin.html'
  link: (scope, elem, attrs) ->
    scope.users = scope.list 'users'
    scope.limit = 20
    scope.page = 1
    scope.sort = 'local.email'
    scope.delete = (user) ->
      if $window.confirm "Are you sure you want to delete #{user.local?.email}"
        scope.users.delete user