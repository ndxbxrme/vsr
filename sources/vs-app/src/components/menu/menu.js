angular.module('vs-app')
.directive('menu', function() {
  return {
    scope: {},
    template: require('./menu.html').default,
    link: (scope) => {
      
    }
  }
})