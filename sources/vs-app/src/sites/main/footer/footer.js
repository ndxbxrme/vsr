angular.module('vs-app')
.directive('footer', function() {
  return {
    scope: {},
    replace: true,
    template: require('./footer.html').default,
    link: (scope) => {
      scope.version = '2.2.2026';
      scope.currentyear = new Date().getFullYear();
    }
  }
})