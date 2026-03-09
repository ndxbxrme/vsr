import './coming-soon.styl'
angular.module('vs-lettings')
.directive('lettingsComingSoon', function(alert, env) {
  return {
    template: require('./coming-soon.html').default,
    scope: {},
    link: (scope) => {
      scope.page = 1;
      scope.limit = 15;
      scope.pageChange = function() {
        return $('html, body').animate({
          scrollTop: 0
        }, 200);
      };
      scope.marketing = scope.list('lettings:marketing', {where:{
        completed: null
      }})
      scope.completedMarketing = (item) => {
        item.completed = true;
        scope.marketing.save(item);
        alert.log('Property marketing completed');
      }
    }
  }
});