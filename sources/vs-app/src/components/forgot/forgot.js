angular.module('vs-app')
.directive('forgot', function($http, $timeout) {
  return {
    template: require('./forgot.html').default,
    scope: {},
    link: function(scope, elem) {
      scope.submit = () => {
        scope.submitted = true;
        if(scope.myform.isValid()) {
          $http.post($http.sites.main.url + '/api/forgot', {email:scope.email}, $http.sites.main.config);
          $timeout(() => $scope.sent = true);
        }
      };
    }
  }
})
.directive('forgotCode', function($http, $stateParams, $state) {
  return {
    template: require('./forgot-response.html').default,
    scope: {},
    link: function(scope, elem) {
      scope.code = $stateParams.code;
    }
  }
})
.config(($stateProvider) => {
  $stateProvider.state('forgot', {
    url: '/forgot',
    template: '<forgot></forgot>',
    data: {title: 'Forgot password'}
  });
  $stateProvider.state('forgot-response', {
    url: '/forgot/:code',
    template: '<forgot-code></forgot-code>',
    data: {title: 'Forgot password'}
  });
})