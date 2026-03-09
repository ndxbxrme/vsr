angular.module 'vsProperty'
.directive 'dezrez', (auth, dezrez, alert, $http, $location) ->
  restrict: 'AE'
  templateUrl: 'directives/dezrez/dezrez.html'
  replace: true
  scope: {}
  link: (scope, elem) ->
    scope.auth = auth
    scope.selectDezrezUser = (user) ->
      $http.post '/api/dezrez/update', dezrez:user
      .then (response) ->
        alert.log 'Successfully connected Dezrez account'
        auth.clearPotentialUsers()
        auth.getUser().dezrez = user
        $location.path '/'
      , ->
        true
    scope.findEmail = ->
      auth.getDezrezPromise scope.dezrezEmail
      .then ->
        alert.log 'Successfully connected Dezrez account'
        dezrez.refresh()
      , ->
        alert.log 'Could not find Dezrez user'
      