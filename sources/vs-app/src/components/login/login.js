(function() {
  'use strict';
  angular.module('vs-app').directive('login', function($http, $location) {
    return {
      restrict: 'AE',
      template: require('./login.html').default,
      replace: true,
      scope: {},
      link: function(scope, elem) {
        scope.login = function() {
          scope.submitted = true;
          if (scope.loginForm.$valid) {
            return $http.post($http.sites.main.url + '/api/login', {
              email: scope.email,
              password: scope.password
            }).then(function(response) {
              if(response.data && response.data.token) {
                $http.sites.main.token = response.data.token;
                $http.sites.main.config = {headers:{Authorization:'Bearer ' + response.data.token}};
                localStorage.setItem('token', response.data.token);
              }
              return scope.auth.getPromise().then(function() {
                return scope.auth.goToNext();
              });
            }, function(err) {
              scope.message = err.data;
              return scope.submitted = false;
            });
          }
        };
        return scope.signup = function() {
          scope.submitted = true;
          if (scope.loginForm.$valid) {
            return $http.post('/api/signup', {
              email: scope.email,
              password: scope.password
            }).then(function(response) {
              return scope.auth.getPromise().then(function() {
                return scope.auth.goToNext();
              });
            }, function(err) {
              scope.message = err.data;
              return scope.submitted = false;
            });
          }
        };
      }
    };
  });

}).call(this);
