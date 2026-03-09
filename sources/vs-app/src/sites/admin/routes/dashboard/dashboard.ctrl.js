import './dashboard.styl'
angular.module('vs-admin')
.directive('adminDashboard', function($http, $timeout, $state, env, alert) {
  return {
    template: require('./dashboard.html').default,
    scope: {},
    link: (scope) => {

    }
  }
});