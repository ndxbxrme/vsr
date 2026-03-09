const bcrypt = require('bcrypt-nodejs');
angular.module('vs-app')
.directive('invited', function($http, $stateParams, $timeout) {
  return {
    template: require('./invited.html').default,
    scope: {},
    link: function(scope, elem) {
      scope.user = scope.single('main:users', {code:$stateParams.code}, (user) => {
        $timeout(() => {
          scope.loaded = true;
          scope.codeGood = user.item;
        });
      });
      scope.submit = () => {
        scope.submitted = true;
        if(scope.myform.isValid() && scope.codeGood && scope.password && (scope.password===scope.repeatPassword)) {
          scope.user.item.local.password = bcrypt.hashSync(scope.password, bcrypt.genSaltSync(8), null);
          scope.user.save();
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