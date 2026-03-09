angular.module('vs-app')
.directive('menu', function(breadcrumbs, $stateParams) {
  return {
    scope: {},
    replace: true,
    template: require('./menu.html').default,
    link: (scope) => {
      scope.breadcrumbs = breadcrumbs;
      scope.stateParams = $stateParams;
      
      scope.isDashboardView = function(view) {
        if (!scope.state('dashboard')) {
          return false;
        }
        return $stateParams.view === view || (!$stateParams.view && view === 'sales');
      };
    }
  }
})