const bcrypt = require('bcrypt-nodejs');
angular.module('vs-app')
.directive('invited', function($http, $stateParams, $timeout, $state) {
  return {
    template: require('./invited.html').default,
    scope: {},
    link: function(scope, elem) {
      $timeout(async () => {
        scope.user = (await $http.post($http.sites['main'].url + '/api/user-code', {code:$stateParams.code}, $http.sites['main'].config)).data.user;
        $timeout(() => {
          scope.loaded = true;
          if(scope.user) {
            scope.codeGood = scope.user.code;
            scope.newUser = !scope.user.displayName;
          }
        })
      })
      scope.submit = async () => {
        scope.submitted = true;
        if(scope.myform.$valid && scope.codeGood && scope.password && (scope.password===scope.repeatPassword)) {
          scope.user.local.password = bcrypt.hashSync(scope.password, bcrypt.genSaltSync(8), null);
          //return
          //delete scope.user.code;
          scope.user.code = null;
          await $http.post($http.sites['main'].url + '/api/complete-registration', {user:scope.user,password:scope.password});
          scope.myform.$setPristine();
          $state.go('dashboard');
          //scope.user.save();
        }
      };
    }
  }
})
.config(($stateProvider) => {
  $stateProvider.state('invited', {
    url: '/invited/:code',
    template: '<invited></invited>',
    data: {title: 'Invited'}
  });
});